import "server-only";

import { jwtVerify, SignJWT } from "jose";

import { deriveKey } from "@/lib/keys";
import { DEFAULT_TENANT, isTenantId } from "@/lib/tenant";

// Headless Chromium doesn't come through Authentik. It reaches a print page with a
// short-lived token instead, signed with a key derived from DOSSIER_SECRET
// and bound to that one page, sent in a request header so it never shows up
// in a URL or a log. It names the tenant too, so the page reads the right
// user's data.

export const PRINT_TOKEN_HEADER = "x-dossier-print-token";
export const PRINT_TOKEN_LIFETIME_SECONDS = 60;

const AUDIENCE = "dossier-print";

/** A token that opens `path` (e.g. "/print/base") for a minute, as `tenant`. */
export async function signPrintToken(path: string, secret?: string, tenant = DEFAULT_TENANT): Promise<string> {
  return new SignJWT({ path, tid: tenant })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${PRINT_TOKEN_LIFETIME_SECONDS}s`)
    .sign(deriveKey("print-token", secret));
}

type VerifyOptions = { secret?: string; now?: Date };

/** The tenant of a valid, unexpired print token for exactly `path`; null for any other token. */
export async function printTokenTenant(
  token: string | null | undefined,
  path: string,
  { secret, now }: VerifyOptions = {},
): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, deriveKey("print-token", secret), {
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: now,
    });
    if (payload.path !== path) return null;
    const tenant = payload.tid ?? DEFAULT_TENANT;
    return isTenantId(tenant) ? tenant : null;
  } catch {
    return null;
  }
}

/** Whether `token` is a valid, unexpired print token for exactly `path`. */
export async function verifyPrintToken(
  token: string | null | undefined,
  path: string,
  options: VerifyOptions = {},
): Promise<boolean> {
  return (await printTokenTenant(token, path, options)) !== null;
}
