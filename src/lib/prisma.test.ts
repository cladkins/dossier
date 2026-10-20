import { describe, expect, it, vi } from "vitest";

import { runWithTenant } from "@/lib/tenant";

import { prisma, prismaFor, systemPrisma, tenantDatabaseName, tenantDatabaseUrl } from "./prisma";

vi.mock("@/lib/env", () => ({ env: { DATABASE_URL: "postgresql://dossier:pw@db:5432/dossier", DOSSIER_SECRET: "p".repeat(32) } }));

const base = "postgresql://dossier:pw@db:5432/dossier?sslmode=disable";

describe("tenant databases", () => {
  it("keeps DATABASE_URL for the default tenant", () => {
    expect(tenantDatabaseUrl("default", base)).toBe(base);
    expect(tenantDatabaseName("default", base)).toBe("dossier");
  });

  it("puts everyone else in <name>_<tenant> on the same server, with the same options", () => {
    const url = new URL(tenantDatabaseUrl("u0123456789abcdef0123", base));
    expect(url.pathname).toBe("/dossier_u0123456789abcdef0123");
    expect(url.host).toBe("db:5432");
    expect(url.username).toBe("dossier");
    expect(url.searchParams.get("sslmode")).toBe("disable");
  });

  it("refuses anything that isn't a tenant id", () => {
    expect(() => tenantDatabaseUrl("x; DROP DATABASE dossier", base)).toThrow();
  });
});

describe("clients", () => {
  it("keeps one client per tenant, without connecting until a query", () => {
    expect(prismaFor("default")).toBe(prismaFor("default"));
    expect(prismaFor("u0123456789abcdef0123")).not.toBe(prismaFor("default"));
  });

  it("gives `prisma` the current tenant's client and `systemPrisma` the main one", () => {
    runWithTenant("u0123456789abcdef0123", () => {
      expect(typeof prisma.job.findMany).toBe("function");
    });
    expect(() => prisma.job).toThrow(/No signed-in user/);
    expect(typeof systemPrisma.$queryRaw).toBe("function");
  });
});
