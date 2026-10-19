import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { TENANT_HEADER, USER_NAME_HEADER, verifyTenantHeader } from "@/lib/tenant";

// Dossier doesn't sign anyone in itself: Authentik's proxy does, in front of
// it, and passes on who it is (see src/lib/auth/proxy-user.ts). src/proxy.ts
// turns that into the tenant, whose database the request reads, and marks
// the request with it, signed. A session is just that mark.

/** Who the request is for. */
export type Session = {
  /** Whose data this request reads (see src/lib/tenant.ts). */
  tenant: string;
  /** The person's name, as Authentik knows it. */
  name?: string;
};

/** The person this request is for, or null without one. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const requestHeaders = await headers();
  const tenant = verifyTenantHeader(requestHeaders.get(TENANT_HEADER));
  if (!tenant) return null;
  const name = requestHeaders.get(USER_NAME_HEADER)?.trim();
  return name ? { tenant, name } : { tenant };
});

/**
 * The session, for pages and layouts: sends the visitor to /login, which
 * explains how to sign in, when there is none. Proxy usually redirects first;
 * this is the check that counts, next to the data.
 */
export async function verifySession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
