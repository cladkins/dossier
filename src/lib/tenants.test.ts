import { beforeEach, describe, expect, it, vi } from "vitest";

import { logServerError } from "@/lib/log";
import { systemPrisma } from "@/lib/prisma";
import { currentTenant } from "@/lib/tenant";

import { ensureTenant, forEachTenant, listTenants, migrateTenants } from "./tenants";

vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  systemPrisma: { $queryRaw: vi.fn(), $executeRawUnsafe: vi.fn() },
  prismaFor: () => ({ $disconnect: async () => {} }),
  tenantDatabaseName: (tenant: string) => (tenant === "default" ? "dossier" : `dossier_${tenant}`),
  tenantDatabaseUrl: (tenant: string) => `postgresql://db/dossier_${tenant}`,
}));
// Migrations and the seed run as child processes; record them instead.
const commands = vi.hoisted(() => ({ calls: [] as { args: string[]; url: string }[], fail: false }));
vi.mock("node:child_process", () => ({
  execFile: (_file: string, args: string[], options: { env: Record<string, string> }, done: (error: Error | null, stdout?: string) => void) => {
    commands.calls.push({ args, url: options.env.DATABASE_URL });
    setTimeout(() => done(commands.fail ? new Error("migration failed") : null, ""), 1);
  },
}));

const sam = "u0123456789abcdef0123";
const kim = "uaaaaaaaaaaaaaaaaaaaa";

beforeEach(() => {
  vi.clearAllMocks();
  commands.calls = [];
  commands.fail = false;
  vi.mocked(systemPrisma.$executeRawUnsafe).mockResolvedValue(0 as never);
});

function databasesExist(...names: string[]) {
  vi.mocked(systemPrisma.$queryRaw).mockImplementation((async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join("?").includes("EXISTS")) return [{ exists: names.includes(String(values[0])) }];
    return names.map((datname) => ({ datname }));
  }) as never);
}

describe("ensureTenant", () => {
  it("creates, migrates and seeds a new user's database, once even when asked twice at once", async () => {
    databasesExist("dossier");
    await Promise.all([ensureTenant(sam), ensureTenant(sam)]);
    expect(systemPrisma.$executeRawUnsafe).toHaveBeenCalledExactlyOnceWith(`CREATE DATABASE "dossier_${sam}"`);
    expect(commands.calls.map((call) => call.args.at(-1))).toEqual(["deploy", expect.stringMatching(/seed/)]);
    expect(commands.calls.every((call) => call.url.endsWith(`dossier_${sam}`))).toBe(true);
  });

  it("does nothing for an existing database or the default tenant", async () => {
    databasesExist("dossier", `dossier_${sam}`);
    await ensureTenant(sam);
    await ensureTenant("default");
    expect(systemPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(commands.calls).toEqual([]);
  });

  it("remembers a database it set up, without asking Postgres again", async () => {
    databasesExist();
    await ensureTenant(sam);
    expect(systemPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("drops a half set-up database, so the next visit starts over", async () => {
    const lee = "ubbbbbbbbbbbbbbbbbbbb";
    databasesExist("dossier");
    commands.fail = true;
    await expect(ensureTenant(lee)).rejects.toThrow(/Setting up the database/);
    expect(systemPrisma.$executeRawUnsafe).toHaveBeenLastCalledWith(`DROP DATABASE IF EXISTS "dossier_${lee}" WITH (FORCE)`);
    commands.fail = false;
    await ensureTenant(lee);
    expect(systemPrisma.$executeRawUnsafe).toHaveBeenLastCalledWith(`CREATE DATABASE "dossier_${lee}"`);
  });

  it("refuses anything that isn't a tenant id", async () => {
    await expect(ensureTenant('x"; DROP DATABASE dossier; --')).rejects.toThrow();
    expect(systemPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe("listTenants", () => {
  it("is the default tenant, then each user's database by its name", async () => {
    databasesExist("dossier", `dossier_${kim}`, `dossier_${sam}`, "dossier_test", "other_u0123456789abcdef0123", "dossier_default");
    expect(await listTenants()).toEqual(["default", sam, kim]);
  });
});

describe("work for every user", () => {
  it("runs as each tenant in turn, and one failure doesn't stop the rest", async () => {
    databasesExist("dossier", `dossier_${sam}`, `dossier_${kim}`);
    const seen: string[] = [];
    await forEachTenant("test", async (tenant) => {
      seen.push(currentTenant());
      if (tenant === sam) throw new Error("boom");
    });
    expect(seen).toEqual(["default", sam, kim]);
    expect(logServerError).toHaveBeenCalledExactlyOnceWith("test", expect.any(Error));
  });

  it("migrates every user's database at startup, but not the main one", async () => {
    databasesExist("dossier", `dossier_${sam}`);
    await migrateTenants();
    expect(commands.calls.map((call) => call.url)).toEqual([`postgresql://db/dossier_${sam}`, `postgresql://db/dossier_${sam}`]);
  });

  it("logs a database that won't migrate and carries on", async () => {
    databasesExist("dossier", `dossier_${sam}`);
    commands.fail = true;
    await migrateTenants();
    expect(logServerError).toHaveBeenCalledWith("startup", expect.any(Error));
  });
});
