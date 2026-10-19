import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { currentTenant, DEFAULT_TENANT, isTenantId } from "@/lib/tenant";

// One client per tenant database, reused across hot reloads in development
// instead of opening a new connection pool on every change.
const globalForPrisma = globalThis as unknown as { prismaClients?: Map<string, PrismaClient> };
const clients = (globalForPrisma.prismaClients ??= new Map());

/** A tenant's own connection pools stay small: a family's worth of users each get one. */
const TENANT_POOL_SIZE = 5;

/**
 * The database a tenant's data lives in: DATABASE_URL's own for the default
 * tenant, and "<that name>_<tenant id>" on the same server for everyone else.
 */
export function tenantDatabaseUrl(tenant: string, base = env.DATABASE_URL): string {
  if (!isTenantId(tenant)) throw new Error("Not a tenant id.");
  if (tenant === DEFAULT_TENANT) return base;
  const url = new URL(base);
  url.pathname = `/${tenantDatabaseName(tenant, base)}`;
  return url.toString();
}

/** The database name for a tenant (see tenantDatabaseUrl()). */
export function tenantDatabaseName(tenant: string, base = env.DATABASE_URL): string {
  const main = decodeURIComponent(new URL(base).pathname.slice(1)) || "postgres";
  return tenant === DEFAULT_TENANT ? main : `${main}_${tenant}`;
}

/** The client for one tenant's database. */
export function prismaFor(tenant: string): PrismaClient {
  let client = clients.get(tenant);
  if (!client) {
    client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: tenantDatabaseUrl(tenant),
        ...(tenant === DEFAULT_TENANT ? {} : { max: TENANT_POOL_SIZE }),
      }),
    });
    clients.set(tenant, client);
  }
  return client;
}

function lazy(resolve: () => PrismaClient): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_, key) {
      const target = resolve();
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * The signed-in user's database (see currentTenant()). It's created on first
 * use rather than on import, so `next build`, which imports every page, works
 * without the secrets that reading `env` requires.
 */
export const prisma: PrismaClient = lazy(() => prismaFor(currentTenant()));

/**
 * The database in DATABASE_URL, whoever is signed in: for what belongs to the
 * server rather than a user, such as the health check.
 */
export const systemPrisma: PrismaClient = lazy(() => prismaFor(DEFAULT_TENANT));
