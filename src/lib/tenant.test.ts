import { describe, expect, it, vi } from "vitest";

import { deriveKey } from "@/lib/keys";

import {
  currentTenant,
  DEFAULT_TENANT,
  isTenantId,
  NoTenantError,
  runWithTenant,
  signTenantHeader,
  tenantForSubject,
  verifyTenantHeader,
} from "./tenant";

const env = vi.hoisted(() => ({ DOSSIER_SECRET: "t".repeat(32), DOSSIER_AUTH: "oidc", DOSSIER_DATA_DIR: "/data" }));
vi.mock("@/lib/env", () => ({ env }));

const key = deriveKey("tenant-header", "t".repeat(32));

describe("tenant ids", () => {
  it("are the default tenant or u and 20 hex digits", () => {
    expect(isTenantId(DEFAULT_TENANT)).toBe(true);
    expect(isTenantId("u0123456789abcdef0123")).toBe(true);
    for (const id of ["", "u123", "U0123456789ABCDEF0123", "u0123456789abcdef0123; DROP", "../default", 42, undefined]) {
      expect(isTenantId(id), String(id)).toBe(false);
    }
  });

  it("come from the issuer and subject, the same every time", () => {
    const id = tenantForSubject("https://auth.example.com/application/o/dossier/", "abc");
    expect(isTenantId(id)).toBe(true);
    expect(tenantForSubject("https://auth.example.com/application/o/dossier/", "abc")).toBe(id);
    expect(tenantForSubject("https://auth.example.com/application/o/dossier/", "abd")).not.toBe(id);
    expect(tenantForSubject("https://other.example.com/", "abc")).not.toBe(id);
  });
});

describe("tenant header", () => {
  it("round-trips a signed tenant", () => {
    expect(verifyTenantHeader(signTenantHeader("u0123456789abcdef0123", key), key)).toBe("u0123456789abcdef0123");
  });

  it("refuses forged, altered, unsigned or missing values", () => {
    const signed = signTenantHeader("u0123456789abcdef0123", key);
    const [, mac] = signed.split(".");
    expect(verifyTenantHeader(`default.${mac}`, key)).toBeNull();
    expect(verifyTenantHeader(signTenantHeader("u0123456789abcdef0123", deriveKey("tenant-header", "x".repeat(32))), key)).toBeNull();
    expect(verifyTenantHeader("u0123456789abcdef0123", key)).toBeNull();
    expect(verifyTenantHeader(`${signed}x`, key)).toBeNull();
    expect(verifyTenantHeader(null, key)).toBeNull();
  });
});

describe("currentTenant", () => {
  it("is the default tenant with password sign-in", () => {
    env.DOSSIER_AUTH = "password";
    expect(currentTenant()).toBe(DEFAULT_TENANT);
    env.DOSSIER_AUTH = "oidc";
  });

  it("with OIDC, is whoever runWithTenant() names, across awaits", async () => {
    await runWithTenant("u0123456789abcdef0123", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentTenant()).toBe("u0123456789abcdef0123");
    });
  });

  it("with OIDC, throws rather than guess when nobody is signed in", () => {
    expect(() => currentTenant()).toThrow(NoTenantError);
    expect(() => runWithTenant("nope", () => 1)).toThrow();
  });
});
