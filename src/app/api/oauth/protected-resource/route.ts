import { connectorOnForAnyone, protectedResourceMetadata } from "@/lib/connector/oauth";
import { publicOrigin } from "@/lib/google/origin";

/** /.well-known/oauth-protected-resource (a rewrite in next.config.ts): who guards /api/mcp (#221). */
export async function GET(request: Request) {
  // Before Claude has a token, so not anyone's in particular.
  if (!(await connectorOnForAnyone())) return new Response(null, { status: 404 });
  return Response.json(protectedResourceMetadata(publicOrigin(request)), { headers: { "access-control-allow-origin": "*" } });
}
