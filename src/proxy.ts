import { NextResponse, type NextRequest } from "next/server";

import { AUTHENTIK_HEADERS, proxyUser, type ProxyUser } from "@/lib/auth/proxy-user";
import { contentSecurityPolicy, createNonce } from "@/lib/csp";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { messages } from "@/lib/messages";
import { PRINT_TOKEN_HEADER, printTokenTenant } from "@/lib/pdf/print-token";
import { signTenantHeader, TENANT_HEADER, USER_NAME_HEADER } from "@/lib/tenant";
import { ensureTenant } from "@/lib/tenants";

/** The Claude connector's endpoint, its sign-in and the metadata that points to them. */
const CONNECTOR_PATHS = /^\/(?:api\/(?:mcp|oauth)(?:\/|$)|\.well-known\/oauth-(?:authorization-server|protected-resource)(?:\/|$))/;

/**
 * Works out who a request is for, from the headers Authentik's proxy adds
 * (see src/lib/auth/proxy-user.ts), makes sure they have a database, and
 * passes their tenant on to the app in TENANT_HEADER, signed (see
 * src/lib/tenant.ts). Requests that didn't come through Authentik go to
 * /login, which explains how to open Dossier. It also gives every page its
 * Content-Security-Policy (E11-5). Pages, layouts, actions and route handlers
 * still check the session themselves, so a matcher mistake can't expose data.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/login") return pass(request, null);
  // The Claude connector (#221) brings its own credentials, an OAuth token
  // that names the person it's for; its routes check it and run as them
  // (src/lib/connector/oauth.ts). They answer 404 while it's off.
  if (CONNECTOR_PATHS.test(pathname)) return pass(request, null);

  const user = proxyUser(withDevUser(request.headers), env.DOSSIER_OWNER);
  if (user) {
    try {
      // Their database, the first time they visit.
      await ensureTenant(user.tenant);
    } catch (error) {
      logServerError("proxy", error);
      return new NextResponse(messages.unexpected, { status: 503 });
    }
    return pass(request, user);
  }

  // Server Actions answer a signed-out call with a friendly error themselves
  // (see action()); a redirect here would break their response.
  if (request.headers.has("next-action")) return pass(request, null);

  // The PDF renderer's headless Chromium opens print pages with a token
  // instead of a cookie; the page checks it again.
  if (pathname.startsWith("/print/")) {
    const tenant = await printTokenTenant(request.headers.get(PRINT_TOKEN_HEADER), pathname);
    if (tenant) return pass(request, { tenant });
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: messages.signedOut }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

/**
 * In development only, with DOSSIER_DEV_USER set: Authentik's user name
 * header for that user on requests that came without one, so `yarn dev`
 * works without Authentik in front.
 */
function withDevUser(requestHeaders: Headers): Headers {
  const devUser = env.DOSSIER_DEV_USER;
  if (process.env.NODE_ENV !== "development" || !devUser || requestHeaders.has(AUTHENTIK_HEADERS.username)) return requestHeaders;
  const headers = new Headers(requestHeaders);
  headers.set(AUTHENTIK_HEADERS.username, devUser);
  return headers;
}

/**
 * Lets the request through, as `user` (or nobody). A TENANT_HEADER or
 * USER_NAME_HEADER the browser sent is always dropped. Pages get the policy on the response, and
 * on the request too: that's where Next.js finds the nonce for its scripts.
 * API answers (JSON, files) need none.
 */
function pass(request: NextRequest, user: ProxyUser | null): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(TENANT_HEADER);
  headers.delete(USER_NAME_HEADER);
  if (user) headers.set(TENANT_HEADER, signTenantHeader(user.tenant));
  // Header values must be Latin-1; a name outside it is left out.
  if (user?.name && /^[\x20-\xff]*$/.test(user.name)) headers.set(USER_NAME_HEADER, user.name);
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next({ request: { headers } });
  // Behind a reverse proxy that ends TLS, only the forwarded header knows.
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? request.nextUrl.protocol.replace(/:$/, "");
  const policy = contentSecurityPolicy(createNonce(), { dev: process.env.NODE_ENV === "development", https: protocol === "https" });
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    // Everything except the health check, Next.js' own assets (scripts,
    // styles, fonts, images), the dev server's hot-reload socket and public
    // files.
    "/((?!api/health(?:/|$)|_next/static/|_next/image|_next/hmr|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
