import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";

import { authMode } from "@/lib/auth/mode";
import { env } from "@/lib/env";
import { deriveKey } from "@/lib/keys";

// Every person who signs in with OIDC gets a tenant: a database of their own
// (see tenantDatabaseUrl() in prisma.ts), so profiles, applications, settings
// and Google accounts never mix. In password mode there is only the default
// tenant, the database in DATABASE_URL.
//
// Code reads the database through `prisma`, which asks currentTenant() which
// database to use. That comes from, in order:
//
// 1. runWithTenant(), for background work (job runner, nightly backups,
//    inbox checks) and for sign-in, before the session cookie exists.
// 2. The request: proxy.ts reads the session and sets TENANT_HEADER on the
//    request, signed with a key derived from DOSSIER_SECRET. A browser can't
//    forge it, and proxy.ts removes any copy the browser sends.
//
// Without either, currentTenant() throws instead of guessing.

export const DEFAULT_TENANT = "default";
export const TENANT_HEADER = "x-dossier-tenant";

const TENANT_ID = /^(?:default|u[0-9a-f]{20})$/;

/** Whether `id` is a tenant id: "default", or "u" and 20 hex digits. */
export function isTenantId(id: unknown): id is string {
  return typeof id === "string" && TENANT_ID.test(id);
}

/**
 * The tenant for an OIDC user: a hash of the issuer and the `sub` claim, which
 * the provider never changes or reuses, unlike user names and email addresses.
 */
export function tenantForSubject(issuer: string, subject: string): string {
  return `u${createHash("sha256").update(`${issuer}\n${subject}`, "utf8").digest("hex").slice(0, 20)}`;
}

function headerMac(id: string, key: Uint8Array): Buffer {
  return createHmac("sha256", key).update(id, "utf8").digest();
}

/** The value proxy.ts puts in TENANT_HEADER: the id and its HMAC. */
export function signTenantHeader(id: string, key = deriveKey("tenant-header")): string {
  return `${id}.${headerMac(id, key).toString("base64url")}`;
}

/** The tenant in a TENANT_HEADER value; null when it's missing or wasn't signed by us. */
export function verifyTenantHeader(value: string | null | undefined, key = deriveKey("tenant-header")): string | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  if (!isTenantId(id)) return null;
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = headerMac(id, key);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

const globalForTenant = globalThis as unknown as { tenantStorage?: AsyncLocalStorage<string> };
// On globalThis, so the dev server's hot reloads and Next.js' separate
// bundles (instrumentation, pages, route handlers) share one storage.
const storage = (globalForTenant.tenantStorage ??= new AsyncLocalStorage<string>());

/** Runs `fn` with `tenant` as the current tenant, and everything it starts too. */
export function runWithTenant<T>(tenant: string, fn: () => T): T {
  if (!isTenantId(tenant)) throw new Error("Not a tenant id.");
  return storage.run(tenant, fn);
}

export class NoTenantError extends Error {
  override name = "NoTenantError";
  constructor() {
    super("No signed-in user for this database access.");
  }
}

/** The tenant set by proxy.ts on the request being handled, if any. */
function requestTenant(): string | null {
  const store = workUnitAsyncStorage.getStore();
  if (!store || !("headers" in store) || !store.headers) return null;
  return verifyTenantHeader(store.headers.get(TENANT_HEADER));
}

/** Whose database to use now. Throws NoTenantError when nobody is signed in. */
export function currentTenant(): string {
  if (authMode() === "password") return DEFAULT_TENANT;
  const tenant = storage.getStore() ?? requestTenant();
  if (!tenant) throw new NoTenantError();
  return tenant;
}

/**
 * The current user's folder for backups and export zips: DOSSIER_DATA_DIR for
 * the default tenant, DOSSIER_DATA_DIR/users/<tenant> for everyone else.
 */
export function dataDir(): string {
  const tenant = currentTenant();
  return tenant === DEFAULT_TENANT ? env.DOSSIER_DATA_DIR : path.join(env.DOSSIER_DATA_DIR, "users", tenant);
}
