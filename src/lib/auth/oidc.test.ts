import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { deriveKey } from "@/lib/keys";
import { DEFAULT_TENANT, tenantForSubject } from "@/lib/tenant";

import { authorizationUrl, finishSignIn, isAllowed, newAttempt, OidcError, type OidcProvider, openAttempt, sealAttempt, tenantFor } from "./oidc";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "o".repeat(32), DOSSIER_OIDC_ALLOWED_GROUPS: [] } }));

const issuer = "https://auth.example.com/application/o/dossier/";
const provider: OidcProvider = {
  issuer,
  authorization_endpoint: "https://auth.example.com/application/o/authorize/",
  token_endpoint: "https://auth.example.com/application/o/token/",
  jwks_uri: "https://auth.example.com/application/o/dossier/jwks/",
};
const redirectUri = "https://dossier.example.com/api/auth/callback";
const stateKey = deriveKey("oidc-state", "o".repeat(32));

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "k1" }] });
});

function idToken(claims: Record<string, unknown>, { aud = "dossier", iss = issuer, key = privateKey } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

function tokenEndpoint(token: string | Promise<string>, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id_token: await token, access_token: "a" }), { status }));
}

describe("sign-in attempts", () => {
  it("round-trip through the encrypted cookie, and nothing else does", async () => {
    const attempt = newAttempt("/profile");
    const sealed = await sealAttempt(attempt, stateKey);
    expect(sealed).not.toContain(attempt.verifier);
    expect(await openAttempt(sealed, stateKey)).toEqual(attempt);
    expect(await openAttempt(sealed, deriveKey("oidc-state", "x".repeat(32)))).toBeNull();
    expect(await openAttempt("junk", stateKey)).toBeNull();
    expect(await openAttempt(undefined, stateKey)).toBeNull();
  });

  it("send the browser to the provider with PKCE, state and nonce", () => {
    const attempt = newAttempt("/");
    const url = new URL(authorizationUrl(provider, attempt, redirectUri, "dossier"));
    expect(url.origin + url.pathname).toBe(provider.authorization_endpoint);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "dossier",
      redirect_uri: redirectUri,
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("code_challenge")).not.toBe(attempt.verifier);
  });
});

describe("finishSignIn", () => {
  const options = (fetchImpl: typeof fetch) => ({ clientId: "dossier", clientSecret: "s3cret", fetchImpl, keys });

  it("trades the code for a verified identity", async () => {
    const attempt = newAttempt("/");
    const fetchImpl = tokenEndpoint(idToken({ nonce: attempt.nonce, preferred_username: "sam", name: "Sam Doe", email: "sam@example.com", groups: ["family", 3] }));
    const identity = await finishSignIn(provider, { code: "c0de", attempt, redirectUri }, options(fetchImpl));
    expect(identity).toEqual({ subject: "user-1", username: "sam", name: "Sam Doe", email: "sam@example.com", groups: ["family"] });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(provider.token_endpoint);
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({ grant_type: "authorization_code", code: "c0de", redirect_uri: redirectUri, code_verifier: attempt.verifier });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${Buffer.from("dossier:s3cret").toString("base64")}`);
  });

  it("refuses a wrong nonce, audience, issuer or signature", async () => {
    const attempt = newAttempt("/");
    const other = (await generateKeyPair("RS256")).privateKey;
    for (const token of [
      idToken({ nonce: "other" }),
      idToken({ nonce: attempt.nonce }, { aud: "someone-else" }),
      idToken({ nonce: attempt.nonce }, { iss: "https://evil.example.com/" }),
      idToken({ nonce: attempt.nonce }, { key: other }),
    ]) {
      await expect(finishSignIn(provider, { code: "c", attempt, redirectUri }, options(tokenEndpoint(token)))).rejects.toThrow(OidcError);
    }
  });

  it("refuses when the provider turns the code down", async () => {
    const attempt = newAttempt("/");
    const fetchImpl = tokenEndpoint(idToken({ nonce: attempt.nonce }), 400);
    await expect(finishSignIn(provider, { code: "c", attempt, redirectUri }, options(fetchImpl))).rejects.toThrow(OidcError);
  });
});

describe("who may sign in, and whose data they get", () => {
  const sam = { subject: "user-1", username: "sam", groups: ["family"] };

  it("lets anyone in without allowed groups, else only members", () => {
    expect(isAllowed(sam, [])).toBe(true);
    expect(isAllowed(sam, ["family", "admins"])).toBe(true);
    expect(isAllowed(sam, ["admins"])).toBe(false);
    expect(isAllowed({ ...sam, groups: [] }, ["family"])).toBe(false);
  });

  it("gives the owner the original database and everyone else their own", () => {
    expect(tenantFor(sam, issuer, "sam")).toBe(DEFAULT_TENANT);
    expect(tenantFor(sam, issuer, "user-1")).toBe(DEFAULT_TENANT);
    expect(tenantFor(sam, issuer, "chris")).toBe(tenantForSubject(issuer, "user-1"));
    expect(tenantFor(sam, issuer, undefined)).toBe(tenantForSubject(issuer, "user-1"));
    // Not by email, which people can often change themselves.
    expect(tenantFor({ ...sam, email: "chris@example.com" }, issuer, "chris@example.com")).not.toBe(DEFAULT_TENANT);
  });
});
