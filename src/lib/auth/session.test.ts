import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveKey } from "@/lib/keys";
import { signTenantHeader, TENANT_HEADER, USER_NAME_HEADER } from "@/lib/tenant";

import { getSession, verifySession } from "./session";

const requestHeaders = vi.hoisted(() => ({ value: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
}));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
// getSession is cached per request in the app; each test is its own request here.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const key = deriveKey("tenant-header", "s".repeat(32));
const sam = "u0123456789abcdef0123";

beforeEach(() => {
  requestHeaders.value = new Headers();
});

describe("getSession", () => {
  it("is the person proxy.ts marked the request with, and their name", async () => {
    requestHeaders.value = new Headers({ [TENANT_HEADER]: signTenantHeader(sam, key), [USER_NAME_HEADER]: " Sam Doe " });
    expect(await getSession()).toEqual({ tenant: sam, name: "Sam Doe" });
  });

  it("leaves the name out when there's none", async () => {
    requestHeaders.value = new Headers({ [TENANT_HEADER]: signTenantHeader(sam, key) });
    expect(await getSession()).toEqual({ tenant: sam });
  });

  it("is nobody without the mark, or with one proxy.ts didn't sign", async () => {
    expect(await getSession()).toBeNull();
    requestHeaders.value = new Headers({ [TENANT_HEADER]: signTenantHeader(sam, deriveKey("tenant-header", "x".repeat(32))) });
    expect(await getSession()).toBeNull();
  });
});

describe("verifySession", () => {
  it("returns the session, or sends the visitor to /login", async () => {
    await expect(verifySession()).rejects.toThrow("redirect /login");
    requestHeaders.value = new Headers({ [TENANT_HEADER]: signTenantHeader(sam, key) });
    await expect(verifySession()).resolves.toEqual({ tenant: sam });
  });
});
