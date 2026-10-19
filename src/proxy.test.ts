// This Next.js version still exports the matcher helper under its Middleware name.
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveKey } from "@/lib/keys";
import { messages } from "@/lib/messages";
import { PRINT_TOKEN_HEADER, signPrintToken } from "@/lib/pdf/print-token";
import { DEFAULT_TENANT, TENANT_HEADER, tenantForSubject, USER_NAME_HEADER, verifyTenantHeader } from "@/lib/tenant";
import { ensureTenant } from "@/lib/tenants";

import { config, proxy } from "./proxy";

const env = vi.hoisted(() => ({ DOSSIER_SECRET: "a".repeat(32), DOSSIER_OWNER: "chris", DOSSIER_DEV_USER: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env }));
vi.mock("@/lib/tenants", () => ({ ensureTenant: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const tenantKey = deriveKey("tenant-header", "a".repeat(32));
/** The tenant the proxy passed on to the app, checked like the app checks it. */
const passedTenant = (response: Response) => verifyTenantHeader(response.headers.get(`x-middleware-request-${TENANT_HEADER}`), tenantKey);
const passedName = (response: Response) => response.headers.get(`x-middleware-request-${USER_NAME_HEADER}`);

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

/** What Authentik's proxy adds for a signed-in user. */
const authentik = (username: string, name = username) => ({
  "x-authentik-uid": `uid-${username}`,
  "x-authentik-username": username,
  "x-authentik-name": name,
});
const sam = authentik("sam", "Sam Doe");
const samTenant = tenantForSubject("authentik", "uid-sam");

function request(path: string, init: { headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, { headers: new Headers(init.headers) });
}

beforeEach(() => vi.mocked(ensureTenant).mockClear());

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
  it("passes on who Authentik signed in, signed, after making sure they have a database", async () => {
    const response = await proxy(request("/profile", { headers: sam }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(passedTenant(response)).toBe(samTenant);
    expect(passedName(response)).toBe("Sam Doe");
    expect(ensureTenant).toHaveBeenCalledWith(samTenant);
    expect(passedTenant(await proxy(request("/api/pdf/1", { headers: sam })))).toBe(samTenant);
  });

  it("gives the owner the original database", async () => {
    expect(passedTenant(await proxy(request("/", { headers: authentik("Chris") })))).toBe(DEFAULT_TENANT);
  });

  it("falls back to the user name when Authentik sends no uid", async () => {
    const response = await proxy(request("/", { headers: { "x-authentik-username": "sam" } }));
    expect(passedTenant(response)).toBe(tenantForSubject("authentik", "sam"));
  });

  it("drops a tenant or name the browser sends itself", async () => {
    const forged = { [TENANT_HEADER]: `${samTenant}.forged`, [USER_NAME_HEADER]: "Mallory" };
    const response = await proxy(request("/login", { headers: forged }));
    expect(response.headers.get(`x-middleware-request-${TENANT_HEADER}`) ?? "").toBe("");
    expect(passedName(response) ?? "").toBe("");
    expect(passedName(await proxy(request("/", { headers: { ...forged, ...authentik("kim") } })))).toBe("kim");
  });

  it("signs in DOSSIER_DEV_USER on the development server only", async () => {
    env.DOSSIER_DEV_USER = "chris";
    try {
      expect(getRedirectUrl(await proxy(request("/")))).toContain("/login");
      vi.stubEnv("NODE_ENV", "development");
      expect(passedTenant(await proxy(request("/")))).toBe(DEFAULT_TENANT);
      // Authentik's own header still wins.
      expect(passedTenant(await proxy(request("/", { headers: sam })))).toBe(samTenant);
    } finally {
      vi.unstubAllEnvs();
      env.DOSSIER_DEV_USER = undefined;
    }
  });

  it("answers 503 when the user's database can't be set up", async () => {
    vi.mocked(ensureTenant).mockRejectedValueOnce(new Error("no CREATEDB"));
    expect((await proxy(request("/", { headers: sam }))).status).toBe(503);
  });

  it("gives pages a Content-Security-Policy with a fresh nonce, for the browser and for Next.js (E11-5)", async () => {
    const first = await proxy(request("/profile", { headers: sam }));
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
    const response = await proxy(request("/api/pdf/1", { headers: sam }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("sends requests that didn't come through Authentik to /login", async () => {
    expect(getRedirectUrl(await proxy(request("/applications/abc?tab=letter")))).toBe("http://localhost:3000/login");
    expect(getRedirectUrl(await proxy(request("/", { headers: { "x-authentik-username": " " } })))).toBe("http://localhost:3000/login");
  });

  it("answers API requests without a user with 401 JSON instead of a redirect", async () => {
    const response = await proxy(request("/api/pdf/1"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: messages.signedOut });
  });

  it("leaves Server Action calls to the action's own session check", async () => {
    const response = await proxy(request("/profile", { headers: { "next-action": "abc123" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets the PDF renderer open a print page as the user its token was made for", async () => {
    const token = await signPrintToken("/print/base", undefined, samTenant);
    const response = await proxy(request("/print/base", { headers: { [PRINT_TOKEN_HEADER]: token } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(passedTenant(response)).toBe(samTenant);
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
});
