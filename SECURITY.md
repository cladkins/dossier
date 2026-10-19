# Security

Dossier is a single-user app you run on your own server. It holds your career history, your job applications and, if you use a hosted model, an AI provider's API key. This page covers what protects that data, what it expects from your setup, and how to report a problem. What Dossier keeps, for how long and who receives what is in [PRIVACY.md](PRIVACY.md).

## Reporting a vulnerability

Please report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Don't open a public issue for it.

## What Dossier does

- **Sign-in.** Dossier has none of its own: Authentik signs people in, in front of it, so Dossier never sees a password. Dossier trusts the `X-authentik-*` headers Authentik's proxy adds, so it only listens on the server itself (`127.0.0.1` in `compose.yml`) and every request has to come through Authentik.
- **Separate data per person.** Each person's data lives in a separate database. `src/proxy.ts` works out whose it is from Authentik's headers and passes it on in a header signed with a key derived from `DOSSIER_SECRET`, after dropping any copy the browser sent, so nobody can pick another person's database. Code that touches the database without a signed-in person fails instead of falling back to someone's data.
- **Every request checks the session.** The proxy only does a quick check before a page renders, so each page, Server Action and route handler checks the session again next to the data. Server Actions go through `action()`, route handlers through `route()`, and a test (`src/lib/session-audit.test.ts`) fails when one doesn't. The only exceptions are signing in and signing out.
- **Cross-site requests.** Next.js refuses Server Actions from another origin, and `route()` does the same for route handlers.
- **Content-Security-Policy.** Every page gets a policy with a fresh nonce: scripts run only when they carry it, nothing loads from other hosts, and no other site may frame Dossier. `next.config.ts` adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` and `Permissions-Policy` to every response.
- **API keys.** Stored encrypted with a key derived from `DOSSIER_SECRET`, never sent to the browser, never logged. The AI provider's key and the job sources' keys each have their own derived key, and each job source's key only goes to that source. The AI server's address is yours to set, so when a request carries a key, Dossier doesn't follow a redirect to another host.
- **Job sources.** Find jobs is off until a source is chosen. Searches go from the server to that source's fixed address only, with a time and size limit; the browser never talks to a job source. A link in a result is kept only when it's `http(s)`, and postings sent back from the browser are checked the same way. Fetching the rest of a posting goes through the same guarded fetcher as Fetch, so it never reaches the server's own network.
- **Google.** Gmail and Calendar are off until you enter your own OAuth client and connect. Signing in is OAuth's authorization code flow with a `state` signed by a key derived from `DOSSIER_SECRET`, valid for 10 minutes, and the callback needs your session too. The refresh token and the client's secret are stored encrypted, each with its own derived key, and never sent to the browser or logged; access tokens stay in the server's memory. Dossier asks only for the permissions of the features you choose (sending, reading, free/busy and events), and every send needs your confirmation.
- **Errors.** Unexpected errors are logged on the server without the data involved; the browser only gets a generic message.

## AI and untrusted text

A job posting, or a reply from Gmail, is text someone else wrote, and it goes into prompts. It could try to steer the model ("ignore your instructions and…"). What limits the damage:

- The model has no tools: it can't read your other data, browse or change anything. It only returns text.
- What it returns is shown as plain text, never as HTML, and checked against a schema before it's saved.
- The fact guard flags claims in a draft that your profile doesn't back up.
- You read every document before you send it, and a drafted answer to a mail only goes out when you confirm it.
- Reading a mail only suggests a status for its application, which you take up or not.

So the worst a hostile posting or mail can do is get odd wording into its own draft, or suggest the wrong status.

## Running it safely

- **Use HTTPS.** Put Dossier behind a reverse proxy that ends TLS (Caddy, Traefik, nginx). Set `Strict-Transport-Security` there. Dossier adds `upgrade-insecure-requests` to its policy when the proxy says the request came over HTTPS (`X-Forwarded-Proto`).
- **Don't expose Dossier's port (38470 by default) directly.** Dossier trusts the `X-authentik-*` headers, so a request that skips Authentik could claim to be anyone.
- **Keep secrets out of `docker inspect`.** Every secret also reads from a file: `DOSSIER_SECRET_FILE`, `DATABASE_URL_FILE`, `DOSSIER_AI_KEY_FILE` and so on, for Docker secrets.
- **Pick a long `DOSSIER_SECRET`** and keep it with your backups: without it, saved API keys can't be read.
- **Keep it updated.** Settings → About tells you when a new version is out.

## Dependencies

Dependabot proposes updates once a week, for the npm packages, GitHub Actions and Docker images. Advisories that `yarn npm audit --all --recursive` still reports, checked on 28 September 2026:

| Package | Advisory | Why it's accepted |
|---|---|---|
| `deepmerge-ts` 7.1.5, from `@prisma/config` | Stack exhaustion on recursive objects ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)) | Only merges Prisma's own config when its CLI starts; no user input reaches it. The fix is in 8.x, which Prisma doesn't support yet. |
| `eslint` 9 | Version no longer supported | Development only. Waits for `eslint-config-next` to support ESLint 10. |

`mysql2`, which Prisma's CLI ships but Dossier never loads (it uses PostgreSQL), is pinned to a patched release in `package.json` `resolutions`. Remove the pin once Prisma updates it.
