import "server-only";

import { DEFAULT_TENANT, tenantForSubject } from "@/lib/tenant";

// Authentik's proxy (its proxy outpost, or forward auth through Caddy,
// Traefik or nginx) signs people in and adds these headers to every request
// it lets through. Dossier trusts them, so it must only be reachable through
// that proxy: compose.yml publishes it on 127.0.0.1 only.

export const AUTHENTIK_HEADERS = {
  /** A stable, hashed id for the user; it never changes or gets reused. */
  uid: "x-authentik-uid",
  username: "x-authentik-username",
  name: "x-authentik-name",
} as const;

/** Who Authentik says is signing in. */
export type ProxyUser = { tenant: string; name?: string };

/**
 * The person on a request, from Authentik's headers; null when there are
 * none (the request didn't come through Authentik). The owner
 * (DOSSIER_OWNER, a user name) keeps the original database; everyone else
 * gets their own.
 */
export function proxyUser(requestHeaders: Headers, owner: string | undefined): ProxyUser | null {
  const read = (name: string) => requestHeaders.get(name)?.trim() || undefined;
  const username = read(AUTHENTIK_HEADERS.username);
  const id = read(AUTHENTIK_HEADERS.uid) ?? username;
  if (!id) return null;
  const tenant = owner && username?.toLowerCase() === owner ? DEFAULT_TENANT : tenantForSubject("authentik", id);
  const name = read(AUTHENTIK_HEADERS.name) ?? username;
  return name ? { tenant, name } : { tenant };
}
