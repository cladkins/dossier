# Developing Dossier

Next.js 16 (App Router) + Prisma 7 + PostgreSQL 18, with Node 24 and Yarn 4 (`corepack enable`). `compose.yml` is for running Dossier, not for developing it; develop on the host. For installing and running Dossier, see the [README](README.md); for how it's secured, [SECURITY.md](SECURITY.md).

## Getting started

```bash
docker run -d --name dossier-db -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dossier postgres:18-alpine
cp .env.example .env
# in .env: DOSSIER_SECRET (openssl rand -base64 32), DOSSIER_OWNER=me and DOSSIER_DEV_USER=me
yarn install
yarn prisma migrate deploy && yarn prisma db seed
yarn dev
```

Open [http://localhost:3000](http://localhost:3000). Authentik signs people in, in front of Dossier; in development, `DOSSIER_DEV_USER` stands in for it: requests without Authentik's headers count as that user (see [Sign-in](#sign-in)). With `DOSSIER_DEV_USER` equal to `DOSSIER_OWNER`, you use the main database.

`.env.example` documents every variable. The server refuses to start while `DOSSIER_SECRET` or `DATABASE_URL` is missing or the secret is shorter than 32 characters, and logs which variable to fix.
Server code reads configuration from the validated `env` object instead of `process.env`:

```ts
import { env } from "@/lib/env";
```

## Database

Define models in `prisma/schema.prisma`, then create and apply a migration, and restart `yarn dev`:

```bash
yarn prisma migrate dev --name <migration-name>
```

Since Prisma 7, `migrate dev` no longer runs `prisma generate` on its own; `yarn prisma generate` does. To browse and edit rows, `yarn prisma studio`.

Query the database from server code with the shared client:

```ts
import { prisma } from "@/lib/prisma";
```

JSON columns (document units, the posting's extracted details, the match, chat edits) are validated with the zod schemas in `src/lib/application-data.ts`.
Change an application's status only through `setStatus` in `src/lib/status-actions.ts` (or `changeStatus()` in client code, which adds the Undo toast), so the funnel figures stay consistent.

### Seed data

Each start runs `prisma db seed`, which creates the six built-in themes, an empty profile and default settings. It never overwrites your profile or settings. To load the prototype's sample data (Jane Doe and nine applications):

```bash
yarn prisma db seed -- --demo           # refuses if you already have a profile or applications
yarn prisma db seed -- --demo --reset   # deletes your profile and applications first
```

## Mutations and private routes

Every mutation goes through one of two helpers. Both check the session first, keep unexpected errors out of responses (they're logged on the server without the data involved), and let `redirect()` and `notFound()` work as usual.

**Server Actions** are the default. Define them with `action(schema, handler)` in a `"use server"` file: the input is validated with zod, and the action returns `{ ok: true, data, toast? } | { ok: false, error, fieldErrors? }`, with messages written for the user.

```ts
// src/app/(app)/settings/actions.ts
"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";

export const renameTheme = action(
  z.object({ id: z.string(), name: z.string().trim().min(1, "Give the theme a name.") }),
  async ({ id, name }, { toast }) => {
    const theme = await prisma.theme.findUnique({ where: { id } });
    if (!theme) throw new ActionError("That theme no longer exists."); // shown to the user
    await prisma.theme.update({ where: { id }, data: { name } });
    toast(`Renamed to “${name}”.`);
    return { id, name };
  },
);
```

On the client, `toastResult()` from `@/components/toast` shows the action's `toast` or its error, and `toast("…")` shows any other message:

```tsx
const result = toastResult(await renameTheme({ id, name }));
```

Next.js already refuses Server Actions whose `Origin` doesn't match the host (or `X-Forwarded-Host` behind a proxy), so keep `experimental.serverActions.allowedOrigins` empty unless the proxy rewrites the host. Action bodies are limited to 1 MB, so large uploads such as imports go through a route handler.

**Route handlers** are for responses a Server Action can't give: files (PDFs, exports), uploads and progress streams. Wrap them in `route()`, which also refuses cross-origin requests (403) and signed-out ones (401), and marks responses `Cache-Control: private, no-store` unless the handler sets its own.

```ts
// src/app/api/pdf/[id]/route.ts
import { route } from "@/lib/route";

export const GET = route<RouteContext<"/api/pdf/[id]">>(async (request, { params }) => {
  const { id } = await params;
  const pdf = await renderPdf(id);
  return new Response(pdf, { headers: { "content-type": "application/pdf" } });
});
```

Both get the session from `getSession()` in `src/lib/auth/session.ts` (see [Sign-in](#sign-in)).

## Sign-in

Dossier has no sign-in of its own. [Authentik](https://goauthentik.io)'s proxy signs people in, in front of it, and adds `X-authentik-uid`, `X-authentik-username` and `X-authentik-name` to every request it lets through. `src/proxy.ts` reads them (`src/lib/auth/proxy-user.ts`), so Dossier must only be reachable through that proxy: `compose.yml` publishes it on `127.0.0.1` only. A request without them goes to `/login`, which only explains this; API routes answer 401. **Sign out** links to Authentik's `/outpost.goauthentik.io/sign_out`.

Each person is a tenant with a database of their own (`src/lib/tenant.ts`, `src/lib/tenants.ts`): `DATABASE_URL`'s database for the owner (`DOSSIER_OWNER`, an Authentik user name), `<name>_u<20 hex digits>` for everyone else, from a hash of their `X-authentik-uid`. `src/proxy.ts` creates the database on a person's first visit; every start migrates them all.

Code keeps using `prisma`: it picks the current tenant's client on every access. In a request that's the tenant `src/proxy.ts` put on the request in `x-dossier-tenant`, signed with a key derived from `DOSSIER_SECRET` (any copy the browser sends is dropped); background work (the job runner, nightly backups, the inbox check, `after()` callbacks) runs inside `runWithTenant()`. Without either, `currentTenant()` throws rather than guess. What belongs to the server rather than a person (the health check) uses `systemPrisma`. Files go under `dataDir()`.

In server code, `getSession()` returns the person (their tenant and name) or null, and `verifySession()` (for pages and layouts) sends the visitor to `/login` when there is none. `action()` and `route()` already check it.

In development, `DOSSIER_DEV_USER` stands in for Authentik: requests without its headers count as that user name. Production servers ignore it. The database tests run as the owner (`src/test/single-user.ts`); the end-to-end tests send Authentik's headers for the owner (`e2e/support.ts`).

## AI provider

Dossier reads job postings and writes drafts with the model you choose in Settings → AI provider: a local model through Ollama or llama.cpp, any OpenAI-compatible server, or Anthropic. Until you save a choice there, the `DOSSIER_AI_*` variables decide (see `.env.example`). API keys are stored encrypted with a key derived from `DOSSIER_SECRET`, and never sent back to the browser.

Long AI tasks run as background jobs (`src/lib/jobs`): the page follows their named steps as they happen and picks them up again after a reload. A job's input and result hold personal data, so they don't last: a job that works on an application names it (`startJob(…, { applicationId })`) and is deleted with it, and finished jobs are deleted once they're older than **Keep task data for** in Settings → Your data (`src/lib/jobs/retention.ts`). Keep nothing in a job that has to outlast that; Undo on a toast and a page reattaching after a reload are fine. The prompts live in `src/lib/ai/tasks`; in strict mode ("Never invent experience", on by default) a fact guard flags names and numbers that aren't in the profile or the posting.

To try the AI features without a hosted provider, run a small model in Docker:

```bash
docker run -d --name ollama -p 127.0.0.1:11434:11434 -v ollama:/root/.ollama ollama/ollama:0.34.4
docker exec ollama ollama pull qwen2.5:3b   # about 2 GB
```

Then pick Local model in Settings with the address `http://localhost:11434`. The Ollama image takes about 9 GB of disk, and a 3B model about 3 GB of memory while it runs; `docker stop ollama` when you're done.

The tests use a mock provider. To check the providers and prompts against real models, run the live tests, which are skipped otherwise:

```bash
AI_LIVE=ollama yarn vitest run src/lib/ai/providers.live.test.ts src/lib/ai/tasks/tasks.live.test.ts
```

## Job search

Find jobs (`/jobs`) searches the job source chosen in Settings → Job search: JSearch, Adzuna or the Bundesagentur für Arbeit. Until a choice is saved, `DOSSIER_JOBS_SOURCE` and the key variables decide (see `.env.example`). In the code, "job" already means a background task (`Job`, `src/lib/jobs`), so a job ad is a "posting", and job search lives in `src/lib/job-search`:

- `search.ts` and `sources.ts`: the query and posting shapes every source maps to, the URL format, and what each source covers. Shared with the browser.
- One adapter per source (`jsearch.ts`, `adzuna.ts`, `arbeitsagentur.ts`), behind `index.ts`, which checks the country, caches answers in memory for 30 minutes and logs a source that changed or isn't answering, without the search. Failures are a `JobSearchError` with a message for the screen.
- `config.ts`: which source and key are in effect. Job source keys are encrypted like the AI key, each kind of secret under its own derived key (`src/lib/secrets.ts`).
- `src/lib/postings.ts`: the `Posting` table holds what the user saved, dismissed or started an application from. `src/lib/posting-searches.ts`: every search, kept with what it found (`PostingSearch`) until the user removes it, so opening one again asks the source nothing.

The tests use answers in each source's shape (`src/test/job-search-fixtures.ts`). The live tests check the real services, and are skipped otherwise. JSearch and Adzuna spend searches from your plan; the Arbeitsagentur is free:

```bash
JOBS_LIVE=jsearch JSEARCH_TEST_KEY=… yarn vitest run src/lib/job-search/jsearch.live.test.ts
JOBS_LIVE=arbeitsagentur yarn vitest run src/lib/job-search/sources.live.test.ts
JOBS_LIVE=adzuna ADZUNA_TEST_APP_ID=… ADZUNA_TEST_KEY=… yarn vitest run src/lib/job-search/sources.live.test.ts
```

## Your data

Settings → Your data exports everything (profile, custom themes, settings, applications with their history, documents, chat and notes, and the postings kept from Find jobs) as one JSON file, and imports such a file to restore it. An import replaces all data in one transaction, after writing a backup of the current data to `DOSSIER_DATA_DIR/backups` (default `/data`; `./data` in development, which git ignores). "Download all PDFs" zips every tailored document there too, in `downloads`, and removes the zip once it's downloaded.

With "Nightly backups" on (the default), the app writes the same export to `backups` every night at 03:00 server time and deletes backups older than `DOSSIER_BACKUP_RETENTION_DAYS` (14 by default). The timer runs inside the app process, so run a single instance of the app. These are the app's own backups: back up the PostgreSQL database itself too, the way your host does it (for example `pg_dump` on a schedule).

### Import size limit

Import files are capped at 10 MB, roughly 500 applications. The limit comes from Next.js, which buffers request bodies up to [`experimental.proxyClientMaxBodySize`](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize) (10 MB by default) because `src/proxy.ts` runs on every request; larger bodies are cut off, so the app refuses them up front. To accept bigger files, raise that option in `next.config.ts` and `IMPORT_MAX_BYTES` in `src/lib/import-limits.ts`. Behind a reverse proxy, its own limit applies as well: with nginx, raise `client_max_body_size` (see Troubleshooting in the README).

## Usage ping

On each day someone signed in opens a page, a production server sends `https://telemetry.dossier.aien.me/ping` the install's random ID and the version, once (`src/lib/usage-ping.ts`, called with `after()` from the signed-in layout). The ID and the day of the last ping are the settings `usagePingId` and `usagePingDay`: exports leave them out and imports keep them (`INSTALL_SETTINGS` in `src/lib/data-export.ts`). Development servers and tests never send it (`NODE_ENV` isn't `production`), and the end-to-end run sets `DOSSIER_TELEMETRY=off`, since it runs a production build.

The receiving end is a Cloudflare Worker that isn't published with the app. Change what the ping sends only together with it, the README's Privacy section and Settings → About.

## Tests and checks

Tests use [Vitest](https://vitest.dev):

```bash
yarn test          # run all tests once
yarn test:watch    # re-run tests on change
yarn test:coverage # run once with coverage (report in coverage/index.html)
yarn lint
yarn typecheck     # generates Next.js route types, then runs tsc
```

Put tests next to the code they cover. `*.test.ts` files run in Node (server code, pure logic);
`*.test.tsx` files run in jsdom with [Testing Library](https://testing-library.com) and its `jest-dom` matchers (components and hooks).
`*.db.test.ts` files run against a real Postgres database: `dossier_test` on the same server (or `TEST_DATABASE_URL`), which is created and migrated at the start of each run, and which each test empties with `resetDatabase()` from `src/test/db.ts`.
They refuse to run against a database whose name doesn't end in `_test`, so your development data is never touched.

GitHub Actions (`.github/workflows/ci.yml`) runs lint, type-check and tests with coverage, with a Postgres service for the database tests, on every pull request and push to `main`, and shows the coverage in the job summary. A newer push to the same branch or pull request cancels the run it replaces. On `main`, a pull request's merge commit isn't checked a second time when it holds exactly the code its pull request's run checked (the branch was up to date with `main`); every other push to `main` is. The coverage thresholds in `vitest.config.mts` ratchet: they sit a few points below the coverage when they were set, and CI fails if coverage drops below them. Raise them when you add tests.

### End-to-end tests

[Playwright](https://playwright.dev) tests in `e2e/` click through the main flows in headless Chromium: the profile, the theme builder and PDFs, finding a job and applying from it, a new application, refining and undoing, the application email, the board and table, the dashboard, and export, delete and import. `e2e/accessibility.spec.ts` runs [axe](https://github.com/dequelabs/axe-core) on every screen and its open menus and dialogs (no serious or critical WCAG 2.2 AA violations allowed) and checks where keyboard focus goes. They run against a production build, on the standalone server the image uses, so build first:

```bash
yarn build && yarn test:e2e
```

The run starts its own server on port 3100 with a separate `dossier_e2e` database (created and migrated on the way, reset to the demo data before the specs that change data), a fake OpenAI-compatible server on port 3999 (`e2e/fake-ai.mts`) that answers each AI task with plausible output, fake job sources on port 3998 (`e2e/fake-jobs.mts`), which the app reaches through `DOSSIER_JOBS_TEST_BASE_URL`, a variable for the tests only, and a fake Google on port 3997 (`e2e/fake-google.mts`) for sign-in, Gmail and Calendar (`DOSSIER_GOOGLE_TEST_BASE_URL`), which only comes into play once a spec enters an OAuth client in Settings → Google. The daily update check asks the same fake instead of GitHub (`DOSSIER_UPDATES_TEST_BASE_URL`), which says no release is out, so a spec can store the latest release itself. Your development server and data are never touched: the tests refuse any database whose name doesn't end in `_e2e`. CI runs them in a job of their own and keeps the report of a failed run as an artifact.

## The production image

The `Dockerfile`'s last stage is the production image, which `compose.yml` runs. It holds the standalone Next.js server, Playwright's Chromium for PDFs, and Prisma's CLI for migrations, runs as `node`, and starts with `docker/start.sh`: `prisma migrate deploy`, the seed (compiled with esbuild at build time), then the server. To build and try it:

```bash
docker build -t dossier:local .
DOSSIER_IMAGE=dossier:local DOSSIER_PORT=3300 docker compose -p dossier-local up -d
```

CI pushes an image for every commit on `main` to `ghcr.io/<owner>/<repository>:<sha>` (lower case), once the checks and the end-to-end tests pass, on `main` or in the commit's pull request. A version tag (`v1.0.0`) then tags that commit's image with the version and `latest`.

## Reset

```bash
docker rm -f dossier-db   # deletes the development database; start again from Getting started
```
