import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { authMode } from "@/lib/auth/mode";
import { logServerError } from "@/lib/log";
import { prismaFor, systemPrisma, tenantDatabaseName, tenantDatabaseUrl } from "@/lib/prisma";
import { DEFAULT_TENANT, isTenantId, runWithTenant } from "@/lib/tenant";

// Each OIDC user's database is created the first time they sign in, with the
// same migrations and built-in themes as the main one. On every start the
// server brings all of them up to date (migrateTenants()), the way start.sh
// does for the main database.

const run = promisify(execFile);

/** How to run Prisma's migrations and the seed: the production image's /app/tools, or the source tree. */
function tools(): { cwd: string; migrate: string[]; seed: string[] } {
  const bundled = path.join(process.cwd(), "tools");
  if (existsSync(path.join(bundled, "seed.mjs"))) {
    return { cwd: bundled, migrate: ["node_modules/prisma/build/index.js", "migrate", "deploy"], seed: ["seed.mjs"] };
  }
  return {
    cwd: process.cwd(),
    migrate: ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    seed: ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"],
  };
}

/** Applies the migrations and the seed to one tenant's database. */
async function migrate(tenant: string): Promise<void> {
  const { cwd, migrate, seed } = tools();
  const options = { cwd, env: { ...process.env, DATABASE_URL: tenantDatabaseUrl(tenant) }, timeout: 5 * 60_000 };
  try {
    await run(process.execPath, migrate, options);
    await run(process.execPath, seed, options);
  } catch {
    // The output names the database server; keep it out of the logs.
    throw new Error(`Setting up the database for user ${tenant} failed. Run \`prisma migrate deploy\` against ${tenantDatabaseName(tenant)} to see why.`);
  }
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function databaseExists(name: string): Promise<boolean> {
  const rows = await systemPrisma.$queryRaw<{ exists: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS "exists"`;
  return rows[0]?.exists === true;
}

const globalForTenants = globalThis as unknown as { tenantSetups?: Map<string, Promise<void>> };
const setups = (globalForTenants.tenantSetups ??= new Map());

/** Creates a tenant's database on first sign-in; does nothing when it exists. */
export function ensureTenant(tenant: string): Promise<void> {
  if (!isTenantId(tenant)) return Promise.reject(new Error("Not a tenant id."));
  if (tenant === DEFAULT_TENANT) return Promise.resolve();
  let setup = setups.get(tenant);
  if (!setup) {
    setup = (async () => {
      const name = tenantDatabaseName(tenant);
      if (await databaseExists(name)) return;
      // The name is built from the tenant id, which is checked above, and the
      // main database's name, so it can't carry SQL; it's quoted all the same.
      await systemPrisma.$executeRawUnsafe(`CREATE DATABASE ${quoteIdent(name)}`);
      try {
        await migrate(tenant);
      } catch (error) {
        // Half set up: drop it, so the next sign-in starts over.
        await prismaFor(tenant).$disconnect().catch(() => {});
        await systemPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`).catch(() => {});
        throw error;
      }
    })().finally(() => setups.delete(tenant));
    setups.set(tenant, setup);
  }
  return setup;
}

/** Every tenant with a database: the default one, then each OIDC user's. */
export async function listTenants(): Promise<string[]> {
  if (authMode() === "password") return [DEFAULT_TENANT];
  const prefix = `${tenantDatabaseName(DEFAULT_TENANT)}_`;
  const rows = await systemPrisma.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database WHERE NOT datistemplate`;
  const others = rows
    .map((row) => row.datname)
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .filter((id) => isTenantId(id) && id !== DEFAULT_TENANT)
    .sort();
  return [DEFAULT_TENANT, ...others];
}

/** Brings every OIDC user's database up to date; called once at startup. */
export async function migrateTenants(): Promise<void> {
  for (const tenant of await listTenants()) {
    if (tenant === DEFAULT_TENANT) continue;
    await migrate(tenant).catch((error: unknown) => logServerError("startup", error));
  }
}

/**
 * Runs `fn` for each tenant in turn, as that tenant, for background work like
 * nightly backups. One tenant's failure is logged and doesn't stop the rest.
 */
export async function forEachTenant(where: string, fn: (tenant: string) => Promise<unknown>): Promise<void> {
  for (const tenant of await listTenants()) {
    await runWithTenant(tenant, () => fn(tenant)).catch((error: unknown) => logServerError(where, error));
  }
}
