import { type NextRequest, NextResponse } from "next/server";

import type { OidcErrorCode } from "@/app/login/messages";
import { authMode } from "@/lib/auth/mode";
import { discover, finishSignIn, isAllowed, OIDC_CALLBACK_PATH, OIDC_STATE_COOKIE, OidcError, openAttempt, tenantFor } from "@/lib/auth/oidc";
import { startSession } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/google/origin";
import { logServerError } from "@/lib/log";
import { ensureTenant } from "@/lib/tenants";

/**
 * Where the provider sends the browser back: checks the state, trades the
 * code for a verified ID token, makes sure the user has a database of their
 * own, and signs them in.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = publicOrigin(request);
  const back = (error: OidcErrorCode) => {
    const response = NextResponse.redirect(new URL(`/login?error=${error}`, origin));
    response.cookies.delete({ name: OIDC_STATE_COOKIE, path: OIDC_CALLBACK_PATH });
    return response;
  };
  if (authMode() !== "oidc") return NextResponse.redirect(new URL("/login", origin));

  const params = request.nextUrl.searchParams;
  const attempt = await openAttempt(request.cookies.get(OIDC_STATE_COOKIE)?.value);
  if (!attempt || params.get("state") !== attempt.state) return back("expired");
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code) return back("failed");

  try {
    const provider = await discover();
    const identity = await finishSignIn(provider, { code, attempt, redirectUri: `${origin}${OIDC_CALLBACK_PATH}` });
    if (!isAllowed(identity)) return back("forbidden");

    const tenant = tenantFor(identity, provider.issuer);
    await ensureTenant(tenant);
    await startSession({ persistent: false, tenant, name: identity.name });
  } catch (error) {
    if (!(error instanceof OidcError)) logServerError("GET /api/auth/callback", error);
    return back("failed");
  }

  const response = NextResponse.redirect(new URL(attempt.next, origin));
  response.headers.set("cache-control", "no-store");
  response.cookies.delete({ name: OIDC_STATE_COOKIE, path: OIDC_CALLBACK_PATH });
  return response;
}
