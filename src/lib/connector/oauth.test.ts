import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ DOSSIER_SECRET: "s".repeat(40) }));
vi.mock("@/lib/env", () => ({ env }));
const settings = vi.hoisted(() => ({ connectorEnabledAt: "2026-10-23T09:00:00.000Z" as string | null }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => settings }));
// Two people; both see the same settings here, so only the token tells them apart.
vi.mock("@/lib/tenants", () => ({ listTenants: async () => ["default", "u0123456789abcdef0123"] }));

import { runWithTenant } from "@/lib/tenant";

import {
  allowedRedirect,
  authorizationServerMetadata,
  challengeOf,
  clientAllows,
  exchangeCode,
  issueCode,
  protectedResourceMetadata,
  readClient,
  refresh,
  registerClient,
  tokenTenant,
  verifyAccessToken,
} from "./oauth";

const SAM = "u0123456789abcdef0123";

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(50);

/** Sam allows Claude in on the consent page. */
async function signIn(redirectUri = CLAUDE) {
  const clientId = await registerClient({ name: "Claude", redirectUris: [redirectUri] });
  const code = await runWithTenant(SAM, () => issueCode({ clientId, redirectUri, codeChallenge: challengeOf(VERIFIER), resource: "https://dossier.example/api/mcp" }));
  return { clientId, code };
}

/** What the token endpoint and /api/mcp do: run as the person the token names. */
const asSam = <T,>(fn: () => Promise<T>) => runWithTenant(SAM, fn);

beforeEach(() => {
  settings.connectorEnabledAt = "2026-10-23T09:00:00.000Z";
});

describe("the Claude connector's sign-in (#221)", () => {
  it("only sends Claude back to its own callbacks, or a loopback address for Claude's command-line app", () => {
    expect(allowedRedirect(CLAUDE)).toBe(true);
    expect(allowedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(allowedRedirect("http://localhost:33418/callback")).toBe(true);
    expect(allowedRedirect("http://127.0.0.1:9/callback")).toBe(true);
    expect(allowedRedirect("https://evil.example/api/mcp/auth_callback")).toBe(false);
    expect(allowedRedirect("https://claude.ai/api/mcp/auth_callback/../evil")).toBe(false);
    expect(allowedRedirect("http://localhost:33418/other")).toBe(false);
    expect(allowedRedirect("https://localhost/callback")).toBe(false);
    expect(allowedRedirect("not a url")).toBe(false);
  });

  it("keeps a client's redirects in its id, ignoring a loopback port that changes", async () => {
    const clientId = await registerClient({ name: "Claude CLI", redirectUris: ["http://localhost:1234/callback"] });
    const client = await readClient(clientId);
    expect(client).toEqual({ name: "Claude CLI", redirectUris: ["http://localhost:1234/callback"] });
    expect(clientAllows(client!, "http://localhost:5678/callback")).toBe(true);
    expect(clientAllows(client!, CLAUDE)).toBe(false);
    expect(await readClient("forged")).toBeNull();
  });

  it("trades a code for tokens with the PKCE verifier, and refreshes them", async () => {
    const { clientId, code } = await signIn();
    expect(await tokenTenant("code", code)).toBe(SAM);
    const tokens = await asSam(() => exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: VERIFIER }));
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "dossier" });
    expect(await tokenTenant("access", tokens.access_token)).toBe(SAM);
    expect(await tokenTenant("refresh", tokens.refresh_token)).toBe(SAM);
    expect(await asSam(() => verifyAccessToken(tokens.access_token))).toEqual({ clientId });
    // A refresh token isn't an access token.
    expect(await asSam(() => verifyAccessToken(tokens.refresh_token))).toBeNull();
    expect(await tokenTenant("access", tokens.refresh_token)).toBeNull();

    const renewed = await asSam(() => refresh({ refreshToken: tokens.refresh_token, clientId }));
    expect(await asSam(() => verifyAccessToken(renewed.access_token))).toEqual({ clientId });
    await expect(asSam(() => refresh({ refreshToken: tokens.refresh_token, clientId: "someone else" }))).rejects.toThrow("The refresh token is invalid or has expired.");
  });

  it("refuses a wrong verifier, another client or another redirect", async () => {
    const { clientId, code } = await signIn();
    await expect(asSam(() => exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: "w".repeat(50) }))).rejects.toThrow("The code verifier doesn't match.");
    await expect(asSam(() => exchangeCode({ code, clientId: "other", redirectUri: CLAUDE, verifier: VERIFIER }))).rejects.toThrow("The code was issued to another client.");
    await expect(asSam(() => exchangeCode({ code, clientId, redirectUri: "https://claude.com/api/mcp/auth_callback", verifier: VERIFIER }))).rejects.toThrow(
      "The redirect URI doesn't match.",
    );
    await expect(asSam(() => exchangeCode({ code: "forged", clientId, redirectUri: CLAUDE, verifier: VERIFIER }))).rejects.toThrow("The code is invalid or has expired.");
    expect(await tokenTenant("code", "forged")).toBeNull();
  });

  it("signs Claude out on Disconnect Claude and when the connector goes off", async () => {
    const { clientId, code } = await signIn();
    const tokens = await asSam(() => exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: VERIFIER }));

    // Disconnect Claude: a new time on the connector.
    settings.connectorEnabledAt = "2026-10-23T10:00:00.000Z";
    expect(await asSam(() => verifyAccessToken(tokens.access_token))).toBeNull();
    await expect(asSam(() => refresh({ refreshToken: tokens.refresh_token, clientId }))).rejects.toThrow("invalid or has expired");
    await expect(asSam(() => exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: VERIFIER }))).rejects.toThrow("invalid or has expired");

    // Off: nothing is issued or accepted.
    const fresh = await signIn();
    const freshTokens = await asSam(() => exchangeCode({ code: fresh.code, clientId: fresh.clientId, redirectUri: CLAUDE, verifier: VERIFIER }));
    settings.connectorEnabledAt = null;
    expect(await asSam(() => verifyAccessToken(freshTokens.access_token))).toBeNull();
    await expect(signIn()).rejects.toThrow("The Claude connector is off.");
  });

  it("only lets a token read the data of the person who allowed it", async () => {
    const { clientId, code } = await signIn();
    const tokens = await asSam(() => exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: VERIFIER }));
    // Sam's token, checked as the owner: refused, even with the same settings.
    expect(await runWithTenant("default", () => verifyAccessToken(tokens.access_token))).toBeNull();
    await expect(runWithTenant("default", () => refresh({ refreshToken: tokens.refresh_token, clientId }))).rejects.toThrow("invalid or has expired");
    await expect(runWithTenant("default", () => exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: VERIFIER }))).rejects.toThrow("invalid or has expired");
  });

  it("describes itself at the addresses Claude looks for", () => {
    expect(authorizationServerMetadata("https://dossier.example")).toMatchObject({
      issuer: "https://dossier.example",
      authorization_endpoint: "https://dossier.example/oauth/authorize",
      token_endpoint: "https://dossier.example/api/oauth/token",
      registration_endpoint: "https://dossier.example/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(protectedResourceMetadata("https://dossier.example")).toMatchObject({
      resource: "https://dossier.example/api/mcp",
      authorization_servers: ["https://dossier.example"],
    });
  });
});
