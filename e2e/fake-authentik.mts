// A stand-in for Authentik's proxy, started by playwright.config.ts. The specs
// open Dossier through it, as people do through the real one: it forwards
// every request to the app with the X-authentik-* headers of the signed-in
// user, the owner (e2e/support.ts). Browsers can't add those headers to every
// request themselves (downloads go without them), so this does, as Authentik
// does in production.

import { createServer, request } from "node:http";

const port = Number(process.env.FAKE_AUTHENTIK_PORT ?? 3100);
const appPort = Number(process.env.APP_PORT ?? 3101);
/** The signed-in user, from e2e/support.ts (AUTHENTIK_HEADERS). */
const user: Record<string, string> = JSON.parse(process.env.AUTHENTIK_HEADERS ?? "{}");

createServer((incoming, outgoing) => {
  if (incoming.url === "/fake-authentik/health") {
    outgoing.end("ok");
    return;
  }
  // Whatever the browser claims is replaced, as Authentik does.
  const headers = Object.fromEntries(Object.entries(incoming.headers).filter(([name]) => !name.startsWith("x-authentik-")));
  const forwarded = request(
    { host: "127.0.0.1", port: appPort, method: incoming.method, path: incoming.url, headers: { ...headers, ...user } },
    (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(outgoing);
    },
  );
  forwarded.on("error", () => {
    outgoing.statusCode = 502;
    outgoing.end();
  });
  incoming.pipe(forwarded);
}).listen(port, () => console.log(`Fake Authentik on http://localhost:${port}, in front of :${appPort}`));
