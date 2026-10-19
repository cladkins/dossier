import "server-only";

import { env } from "@/lib/env";

/**
 * How people sign in: "password" (one shared password, one profile; the
 * original single-user mode) or "oidc" (each person signs in with an OpenID
 * Connect provider such as Authentik and gets a profile of their own).
 */
export type AuthMode = "password" | "oidc";

export function authMode(): AuthMode {
  return env.DOSSIER_AUTH === "oidc" ? "oidc" : "password";
}
