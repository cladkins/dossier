import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";

import { env } from "@/lib/env";
import { deriveKey } from "@/lib/keys";
import { DEFAULT_TENANT, tenantForSubject } from "@/lib/tenant";

// Sign-in with an OpenID Connect provider such as Authentik: the
// authorization code flow with PKCE, a state and a nonce. The password never
// reaches Dossier; the provider vouches for who signed in with an ID token
// signed by its own keys, which are checked here.

export const OIDC_STATE_COOKIE = "dossier_oidc";
/** How long the provider's sign-in page may take before the attempt expires. */
export const OIDC_STATE_LIFETIME_SECONDS = 10 * 60;
export const OIDC_CALLBACK_PATH = "/api/auth/callback";

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  end_session_endpoint: z.url().optional(),
});

export type OidcProvider = z.infer<typeof discoverySchema>;

const globalForOidc = globalThis as unknown as {
  oidcDiscovery?: { issuer: string; provider: Promise<OidcProvider> };
  oidcKeys?: { uri: string; keys: ReturnType<typeof createRemoteJWKSet> };
};

/** The provider's endpoints, from its discovery document; fetched once. */
export function discover(issuer = env.DOSSIER_OIDC_ISSUER!, fetchImpl: typeof fetch = fetch): Promise<OidcProvider> {
  const cached = globalForOidc.oidcDiscovery;
  if (cached?.issuer === issuer) return cached.provider;
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const provider = (async () => {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`The OIDC provider's discovery document answered ${response.status}.`);
    return discoverySchema.parse(await response.json());
  })();
  // A failure isn't kept: the next sign-in tries again.
  provider.catch(() => {
    if (globalForOidc.oidcDiscovery?.provider === provider) globalForOidc.oidcDiscovery = undefined;
  });
  globalForOidc.oidcDiscovery = { issuer, provider };
  return provider;
}

function remoteKeys(uri: string) {
  if (globalForOidc.oidcKeys?.uri !== uri) globalForOidc.oidcKeys = { uri, keys: createRemoteJWKSet(new URL(uri)) };
  return globalForOidc.oidcKeys.keys;
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** What's kept in OIDC_STATE_COOKIE between sending the browser off and its return. */
export type OidcAttempt = { state: string; nonce: string; verifier: string; next: string };

/** A new sign-in attempt: random state, nonce and PKCE verifier. */
export function newAttempt(next: string): OidcAttempt {
  return { state: base64url(randomBytes(32)), nonce: base64url(randomBytes(32)), verifier: base64url(randomBytes(32)), next };
}

/** The attempt, encrypted for OIDC_STATE_COOKIE. */
export async function sealAttempt(attempt: OidcAttempt, key = deriveKey("oidc-state")): Promise<string> {
  return new EncryptJWT({ ...attempt })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${OIDC_STATE_LIFETIME_SECONDS}s`)
    .encrypt(key);
}

const attemptSchema = z.object({ state: z.string(), nonce: z.string(), verifier: z.string(), next: z.string() });

/** The attempt in OIDC_STATE_COOKIE; null when missing, expired or tampered with. */
export async function openAttempt(token: string | undefined, key = deriveKey("oidc-state")): Promise<OidcAttempt | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key, { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"], requiredClaims: ["exp"] });
    const parsed = attemptSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Where to send the browser to sign in. */
export function authorizationUrl(provider: OidcProvider, attempt: OidcAttempt, redirectUri: string, clientId = env.DOSSIER_OIDC_CLIENT_ID!): string {
  const url = new URL(provider.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: base64url(createHash("sha256").update(attempt.verifier).digest()),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Thrown when sign-in can't finish; the message is safe to show. */
export class OidcError extends Error {
  override name = "OidcError";
}

/** Who signed in, from a verified ID token. */
export type OidcIdentity = {
  subject: string;
  username?: string;
  email?: string;
  name?: string;
  groups: string[];
};

const tokenResponseSchema = z.object({ id_token: z.string() });

/** Trades the code for tokens and verifies the ID token: signature, issuer, audience, expiry, nonce. */
export async function finishSignIn(
  provider: OidcProvider,
  { code, attempt, redirectUri }: { code: string; attempt: OidcAttempt; redirectUri: string },
  {
    clientId = env.DOSSIER_OIDC_CLIENT_ID!,
    clientSecret = env.DOSSIER_OIDC_CLIENT_SECRET!,
    fetchImpl = fetch,
    keys = remoteKeys(provider.jwks_uri),
  }: { clientId?: string; clientSecret?: string; fetchImpl?: typeof fetch; keys?: Parameters<typeof jwtVerify>[1] } = {},
): Promise<OidcIdentity> {
  const response = await fetchImpl(provider.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: attempt.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new OidcError("The sign-in provider refused the sign-in. Try again.");
  const tokens = tokenResponseSchema.safeParse(await response.json().catch(() => null));
  if (!tokens.success) throw new OidcError("The sign-in provider didn't send an ID token.");

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(tokens.data.id_token, keys as Parameters<typeof jwtVerify>[1], {
      issuer: provider.issuer,
      audience: clientId,
      requiredClaims: ["sub", "exp", "iat"],
    }));
  } catch {
    throw new OidcError("The sign-in provider's answer couldn't be verified. Try again.");
  }
  if (payload.nonce !== attempt.nonce) throw new OidcError("This sign-in has expired. Try again.");

  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  return {
    subject: payload.sub!,
    username: text(payload.preferred_username),
    email: text(payload.email),
    name: text(payload.name) ?? text(payload.given_name) ?? text(payload.preferred_username),
    groups: Array.isArray(payload.groups) ? payload.groups.filter((group): group is string => typeof group === "string") : [],
  };
}

/** Whether `identity` may sign in: a member of an allowed group, when groups are set. */
export function isAllowed(identity: OidcIdentity, allowedGroups = env.DOSSIER_OIDC_ALLOWED_GROUPS): boolean {
  if (allowedGroups.length === 0) return true;
  return identity.groups.some((group) => allowedGroups.includes(group));
}

/**
 * Whose database a user gets: the owner (DOSSIER_OIDC_OWNER, a user name or
 * `sub`) keeps the original one, everyone else gets their own. Not matched by
 * email: people can often change their own email at the provider.
 */
export function tenantFor(identity: OidcIdentity, issuer: string, owner = env.DOSSIER_OIDC_OWNER): string {
  if (owner && (identity.username?.toLowerCase() === owner || identity.subject.toLowerCase() === owner)) return DEFAULT_TENANT;
  return tenantForSubject(issuer, identity.subject);
}
