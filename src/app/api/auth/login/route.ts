import { type NextRequest, NextResponse } from "next/server";

import { authMode } from "@/lib/auth/mode";
import { safeNextPath } from "@/lib/auth/next-path";
import { authorizationUrl, discover, newAttempt, OIDC_CALLBACK_PATH, OIDC_STATE_COOKIE, OIDC_STATE_LIFETIME_SECONDS, sealAttempt } from "@/lib/auth/oidc";
import { publicOrigin } from "@/lib/google/origin";
import { logServerError } from "@/lib/log";

/** Starts an OIDC sign-in: sends the browser to the provider (e.g. Authentik). */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = publicOrigin(request);
  if (authMode() !== "oidc") return NextResponse.redirect(new URL("/login", origin));

  const requested = safeNextPath(request.nextUrl.searchParams.get("next"));
  const next = requested.startsWith("/api/auth/") ? "/" : requested;
  let provider;
  try {
    provider = await discover();
  } catch (error) {
    logServerError("GET /api/auth/login", error);
    return NextResponse.redirect(new URL("/login?error=provider", origin));
  }

  const attempt = newAttempt(next);
  const response = NextResponse.redirect(authorizationUrl(provider, attempt, `${origin}${OIDC_CALLBACK_PATH}`));
  response.headers.set("cache-control", "no-store");
  response.cookies.set(OIDC_STATE_COOKIE, await sealAttempt(attempt), {
    httpOnly: true,
    // Lax: the provider sends the browser back with a top-level GET.
    sameSite: "lax",
    secure: origin.startsWith("https:"),
    path: OIDC_CALLBACK_PATH,
    maxAge: OIDC_STATE_LIFETIME_SECONDS,
  });
  return response;
}
