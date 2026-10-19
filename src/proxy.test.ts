// This Next.js version still exports the matcher helper under its Middleware name.
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { encodeSession, passwordFingerprint, SESSION_COOKIE } from "@/lib/auth/session";
import { deriveKey } from "@/lib/keys";
import { messages } from "@/lib/messages";
import { PRINT_TOKEN_HEADER, signPrintToken } from "@/lib/pdf/print-token";
import { TENANT_HEADER, verifyTenantHeader } from "@/lib/tenant";

import { config, proxy } from "./proxy";

vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "a".repeat(32), DOSSIER_PASSWORD: "correct horse" },
}));

const key = deriveKey("session", "a".repeat(32));
const fingerprint = passwordFingerprint("correct horse", deriveKey("password-fingerprint", "a".repeat(32)));

const tenantKey = deriveKey("tenant-header", "a".repeat(32));
/** The tenant the proxy passed on to the app, checked like the app checks it. */
const passedTenant = (response: Response) => verifyTenantHeader(response.headers.get(`x-middleware-request-${TENANT_HEADER}`), tenantKey);

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

function request(path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", `${SESSION_COOKIE}=${init.cookie}`);
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

describe("proxy matcher", () => {
  it("runs on pages, the sign-in page and API routes", () => {
    for (const url of ["/", "/login", "/profile", "/applications/abc", "/new", "/dev/ui", "/api/pdf/1", "/loginx"]) {
      expect(matches(url), url).toBe(true);
    }
  });

  it("skips the health check, Next.js assets and public files", () => {
    for (const url of [
      "/api/health",
      "/_next/static/chunks/app.js",
      "/_next/static/media/Geist.woff2",
      "/_next/image?url=/a.png&w=64&q=75",
      "/_next/hmr",
      "/favicon.ico",
      "/next.svg",
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });
});

describe("proxy", () => {
  it("lets signed-in requests through", async () => {
    const token = await encodeSession({ persistent: false }, { key, fingerprint });
    const response = await proxy(request("/profile", { cookie: token }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("gives pages a Content-Security-Policy with a fresh nonce, for the browser and for Next.js (E11-5)", async () => {
    const token = await encodeSession({ persistent: false }, { key, fingerprint });
    const first = await proxy(request("/profile", { cookie: token }));
    const second = await proxy(request("/login"));
    const policy = first.headers.get("content-security-policy");
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    // Next.js reads the request's copy to put the nonce on its scripts.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(second.headers.get("x-middleware-next")).toBe("1");
    expect(second.headers.get("content-security-policy")).not.toBe(policy);
  });

  it("upgrades insecure requests only when the page was asked for over HTTPS", async () => {
    const plain = await proxy(request("/login"));
    const behindTls = await proxy(request("/login", { headers: { "x-forwarded-proto": "https" } }));
    expect(plain.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
    expect(behindTls.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
  });

  it("leaves API answers without a policy", async () => {
    const token = await encodeSession({ persistent: false }, { key, fingerprint });
    const response = await proxy(request("/api/pdf/1", { cookie: token }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("sends signed-out visitors to /login, remembering where they were going", async () => {
    expect(getRedirectUrl(await proxy(request("/applications/abc?tab=letter")))).toBe(
      "http://localhost:3000/login?next=%2Fapplications%2Fabc%3Ftab%3Dletter",
    );
    expect(getRedirectUrl(await proxy(request("/")))).toBe("http://localhost:3000/login");
  });

  it("treats an expired, forged or pre-password-change cookie as signed out", async () => {
    const expired = await encodeSession(
      { persistent: false },
      { key, fingerprint, now: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    );
    const forged = await encodeSession({ persistent: true }, { key: deriveKey("session", "b".repeat(32)), fingerprint });
    const oldPassword = await encodeSession({ persistent: true }, { key, fingerprint: "stale-fingerprint" });
    for (const cookie of [expired, forged, oldPassword, "garbage"]) {
      expect(getRedirectUrl(await proxy(request("/profile", { cookie })))).toContain("/login");
    }
  });

  it("answers API requests with 401 JSON instead of a redirect", async () => {
    const response = await proxy(request("/api/pdf/1"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: messages.signedOut });
  });

  it("leaves Server Action calls to the action's own session check", async () => {
    const response = await proxy(request("/profile", { headers: { "next-action": "abc123" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets the PDF renderer open a print page with a token for that page", async () => {
    const token = await signPrintToken("/print/base");
    const response = await proxy(request("/print/base", { headers: { [PRINT_TOKEN_HEADER]: token } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses print tokens for another page, forged ones and tokens outside /print", async () => {
    const other = await signPrintToken("/print/resume/1");
    const forged = await signPrintToken("/print/base", "b".repeat(32));
    for (const token of [other, forged, "garbage"]) {
      const response = await proxy(request("/print/base", { headers: { [PRINT_TOKEN_HEADER]: token } }));
      expect(getRedirectUrl(response)).toContain("/login");
    }
    const profileToken = await signPrintToken("/profile");
    const response = await proxy(request("/profile", { headers: { [PRINT_TOKEN_HEADER]: profileToken } }));
    expect(getRedirectUrl(response)).toContain("/login");
  });

  it("passes the session's tenant on, signed, to pages and API routes", async () => {
    const token = await encodeSession({ persistent: false, tenant: "u0123456789abcdef0123" }, { key, fingerprint });
    expect(passedTenant(await proxy(request("/profile", { cookie: token })))).toBe("u0123456789abcdef0123");
    expect(passedTenant(await proxy(request("/api/pdf/1", { cookie: token })))).toBe("u0123456789abcdef0123");
  });

  it("drops a tenant header the browser sends", async () => {
    const forged = { [TENANT_HEADER]: "u0123456789abcdef0123.forged" };
    const token = await encodeSession({ persistent: false }, { key, fingerprint });
    expect(passedTenant(await proxy(request("/profile", { cookie: token, headers: forged })))).toBe("default");
    for (const path of ["/login", "/api/auth/callback"]) {
      const response = await proxy(request(path, { headers: forged }));
      expect(response.headers.get(`x-middleware-request-${TENANT_HEADER}`) ?? "").toBe("");
    }
  });

  it("lets the OIDC sign-in routes through signed out", async () => {
    for (const path of ["/api/auth/login", "/api/auth/callback"]) {
      expect((await proxy(request(path))).headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("opens a print page as the user its token was made for", async () => {
    const token = await signPrintToken("/print/base", undefined, "u0123456789abcdef0123");
    const response = await proxy(request("/print/base", { headers: { [PRINT_TOKEN_HEADER]: token } }));
    expect(passedTenant(response)).toBe("u0123456789abcdef0123");
  });
});
