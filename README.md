<p align="center">
  <img src="src/app/icon.svg" alt="" width="80" height="80">
</p>

<h1 align="center">Dossier</h1>

<p align="center">
  Your job search, on your own server: one profile, a tailored resume and cover letter for every job, and every application tracked from draft to offer.
</p>

<p align="center">
  <a href="https://github.com/AienTech/dossier/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/AienTech/dossier?label=release"></a>
  <a href="https://github.com/AienTech/dossier/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/AienTech/dossier/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://github.com/AienTech/dossier/pkgs/container/dossier"><img alt="Docker image: ghcr.io/aientech/dossier" src="https://img.shields.io/badge/image-ghcr.io%2Faientech%2Fdossier-2496ED?logo=docker&logoColor=white"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs">
  <img alt="PostgreSQL 18" src="https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white">
</p>

Dossier keeps your career history in one profile and turns it into a clean resume. For every job you apply to, it reads the posting, shows how you match, and drafts a tailored resume and cover letter that only use facts from your profile. You refine them in a chat, download them as PDFs and track each application from draft to offer.

It's for you and your family on a small server: each person signs in through Authentik and gets a profile of their own, all in your own PostgreSQL database, and an AI model of your choice. That can be a local model through Ollama or LM Studio, so your profile and documents stay on your own hardware, or a hosted one (any OpenAI-compatible API, Anthropic or Mistral), which then receives what it writes from. [Privacy](https://github.com/AienTech/dossier/wiki/Privacy) says what goes where.

**This fork** (`cladkins/dossier`) adds sign-in through Authentik with a profile per person, and runs its own image, `ghcr.io/cladkins/dossier`. Set it up with [Self-hosting](#self-hosting) below. Upstream's [wiki](https://github.com/AienTech/dossier/wiki) still applies to everything after sign-in (AI providers, job sources, Gmail, backups); its installation pages, password and `hash-password` don't apply here.

## Demo

![Dossier in use: the dashboard, dragging a card on the board, a new application from a pasted posting, refining the tailored resume in the chat, the cover letter, and switching resume themes](.github/images/demo.gif)

<sub>Recorded with the demo data (Jane Doe is made up) and a stand-in AI server that answers at once, played at 1.2× speed. With a real model, reading a posting and writing the documents takes from a few seconds to a few minutes.</sub>

## Features

- **Profile:** basics, skills and languages, experience, projects, education, publications and references, in the order you choose, with a strength meter that counts only what a profile needs. Projects (side, open-source, course or thesis work) show what you can do where your job titles don't yet. Publications are cited in your own style, with bold and italics, and go on resumes word for word. Start it from an existing resume (PDF, Word or Markdown) if you like.
- **Base resume:** twelve themes and a theme builder, previewed live and printed to PDF on the server. Duplicate themes, or share them as files.
- **Find jobs:** search postings near your city, or anywhere you choose, through JSearch (LinkedIn, Indeed and more) or Adzuna. Save the good ones, dismiss the rest, score any of them against your profile, and start an application from a posting with one click.
- **Startups:** startups that are hiring, from YC startups' job posts and Hacker News' monthly “Who is hiring?” thread, kept to the ones that hire where you live or remotely from your country and ranked against your profile, with the address each one publishes for applications. Dossier reads their sites politely and follows their robots.txt. Start an application to one with a click; you decide whom to write to.
- **Job agent (optional):** once a day it runs one search for you, skips what you've seen, scores the new postings against your profile and keeps the best on the Agent screen, with its reasons. It can prepare tailored drafts too, which wait for your review. It never sends or applies.
- **New application:** paste a posting; Dossier pulls out the details and requirements, matches them against your profile, and writes a tailored resume and cover letter in the tone you pick.
- **Never invents experience:** drafts only use facts from your profile. What the posting asks for and your profile doesn't have is shown as a gap, not made up.
- **Refine:** ask for changes in a chat, edit or regenerate any part (every part of the cover letter too: sender, date, recipient, greeting and sign-off, written in the letter's language), undo AI changes or go back to any earlier version, keep private notes.
- **Send:** an email to go with each application, to whoever the posting says to send it to, ready to copy or open in your mail app, with the resume and cover letter PDFs to attach. Edit, rewrite or refine it like the documents.
- **Claude connector (optional):** use Dossier from Claude, on claude.ai, in the Desktop and mobile apps or in Claude's command-line app, on your own Claude plan. Claude can search for jobs, score them against your profile, read your profile and applications, and save the resume and cover letter it writes as a Draft, checked like Dossier's own. It never sends or deletes anything. Without an AI model of Dossier's own, **Write it with Claude** hands a posting to a new Claude chat. Turn it on in Settings → Claude connector (see [Connecting Claude](https://github.com/AienTech/dossier/wiki/Connecting-Claude)).
- **Gmail and Calendar (optional):** connect your Google account to send an application from your own address with its PDFs attached, see employers' replies next to each application, have the AI read what they ask and draft your answer from your profile, offer interview times you're free, and see your month and the week ahead on the dashboard, with interviews kept in step with Google Calendar both ways. Nothing is sent without your confirmation. Set it up by entering your Google OAuth client in Settings → Google, or with `DOSSIER_GOOGLE_CLIENT_ID` and `DOSSIER_GOOGLE_CLIENT_SECRET` (see [Connecting Gmail and Calendar](https://github.com/AienTech/dossier/wiki/Connecting-Gmail-and-Calendar)).
- **Track:** a board and a table of every application, and a dashboard with your funnel (last 30 days, 90 days or all time), a week-by-week chart, what's worth a look next, upcoming interviews included, and a calendar.
- **Your data:** export and import everything as one file, nightly backups, and Delete everything.

## Screenshots

![The dashboard: your funnel, a week-by-week chart and what's worth a look next](.github/images/dashboard.png)

<table>
  <tr>
    <td width="50%"><img src=".github/images/application.png" alt="An application with its tailored resume and the chat that refines it"><br>An application: the tailored resume, and a chat to refine it</td>
    <td width="50%"><img src=".github/images/new-application.png" alt="A new application, showing how the profile matches the posting's requirements"><br>A new application: how you match the posting</td>
  </tr>
  <tr>
    <td><img src=".github/images/applications.png" alt="The applications board, with columns from draft to offer"><br>Every application on a board, from draft to offer</td>
    <td><img src=".github/images/find-jobs.png" alt="Find jobs: postings near the profile's city, with one open"><br>Find jobs and start an application from a posting</td>
  </tr>
  <tr>
    <td><img src=".github/images/resume.png" alt="The base resume next to its themes"><br>The base resume, with twelve themes and a theme builder</td>
    <td><img src=".github/images/profile.png" alt="The profile editor, with its sections and strength meter"><br>One profile that every resume and letter comes from</td>
  </tr>
  <tr>
    <td><img src=".github/images/inbox.png" alt="The inbox: employers' replies from Gmail, what each one asks, and mail to link to an application"><br>Replies from Gmail, read by the AI, with answers it drafts</td>
    <td><img src=".github/images/calendar.png" alt="The dashboard on a wide window, with the calendar beside the cards: the month, and the week ahead with an interview among the Google Calendar's events"><br>Your interviews and Google Calendar on the dashboard, kept in step</td>
  </tr>
</table>

<sub>The screenshots show the demo data: Jane Doe is made up.</sub>

## Self-hosting

Dossier runs as two containers, the app and PostgreSQL, from one Compose file. These four steps take a fresh server to Dossier on your own domain, with HTTPS.

### 1. Get a VPS

Any Linux server you can reach over SSH works, from any provider. Give it:

- **At least 2 vCPUs and 2 GB of memory.** Dossier uses up to about 1 GB, since it prints PDFs with a built-in Chromium; PostgreSQL and the system need the rest (see [Performance and sizing](#performance-and-sizing)).
- **A few GB of disk.** The image is about 1.7 GB; your data takes far less.
- **More for a local model:** about 6 GB of extra memory and 4 or more cores for `qwen2.5:7b` (see [Local model with Ollama](https://github.com/AienTech/dossier/wiki/Choosing-an-AI-provider)). With a hosted AI provider, you don't need any of that.
- **A domain name** for HTTPS, such as `dossier.example.com`, with a DNS `A` record pointing at the server.

The commands below are for Debian or Ubuntu. Only SSH (port 22) and the web (80 and 443) need to be open to the internet.

### 2. Install Docker and Docker Compose

Docker's install script sets up Docker Engine and the Compose plugin:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

The last line lets you run `docker` without `sudo` (membership in the `docker` group is as good as root, so only add accounts you trust). Log out and back in for it to apply, then check:

```bash
docker compose version
```

To install by hand instead, follow [Docker's guide for your distribution](https://docs.docker.com/engine/install/).

### 3. Set up Dossier

Dossier keeps everything in PostgreSQL 18, which runs in its own container next to the app. Nothing outside can reach it, only the app, and its data lives in a Docker volume that survives restarts and upgrades.

Make a folder for Dossier, fetch the Compose file into it, and fill in `.env`:

```bash
mkdir ~/dossier && cd ~/dossier
curl -fsSL -o compose.yml https://raw.githubusercontent.com/cladkins/dossier/main/compose.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
echo "DOSSIER_SECRET=$(openssl rand -base64 32)" >> .env
echo "DOSSIER_OWNER=<your Authentik user name>" >> .env
chmod 600 .env
```

- **`DOSSIER_SECRET`** encrypts saved API keys and signs what Dossier passes around internally.
- **`DOSSIER_OWNER`** is your Authentik user name. You keep the data in the main database; everyone else gets an empty profile of their own.

`.env` holds your secrets, so it's readable only by you. Start Dossier and watch it come up:

```bash
docker compose up -d
docker compose logs -f app
```

On every start, Dossier applies the database migrations and loads its built-in themes before it serves, and the log shows each step. Press Ctrl+C to stop following it. `curl -s localhost:38470/api/health` answers `{"status":"ok", …}` once it's up.

### 4. Put Authentik in front of it

Dossier has no sign-in of its own. [Authentik](https://goauthentik.io) signs people in, in front of it, and tells Dossier who each person is. Dossier only listens on the server itself (`127.0.0.1:38470`), so every request goes through Authentik. See [Signing in with Authentik](#signing-in-with-authentik) for the Authentik side. With [Caddy](https://caddyserver.com), which also gets and renews the HTTPS certificate on its own:

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
dossier.example.com {
    route {
        # Authentik's own pages: sign-in, sign-out.
        reverse_proxy /outpost.goauthentik.io/* https://auth.example.com {
            header_up Host {upstream_hostport}
        }
        # Asks Authentik about every request and passes on who signed in.
        forward_auth https://auth.example.com {
            uri /outpost.goauthentik.io/auth/caddy
            copy_headers X-Authentik-Username X-Authentik-Uid X-Authentik-Name X-Authentik-Email X-Authentik-Groups
            trusted_proxies private_ranges
        }
        reverse_proxy localhost:38470
    }
}
EOF
sudo systemctl reload caddy
```

Replace `auth.example.com` with your Authentik's address. Open `https://dossier.example.com`, sign in with Authentik, then pick an AI model in **Settings → AI provider** (see [Choosing an AI provider](https://github.com/AienTech/dossier/wiki/Choosing-an-AI-provider)) and, if you like, a job source in **Settings → Job search**.

<details>
<summary>Traefik, nginx or Nginx Proxy Manager</summary>

Use Authentik's forward auth for your proxy (Authentik shows the snippet on the provider's page). It has to:

- pass `X-authentik-uid`, `X-authentik-username` and `X-authentik-name` from Authentik's answer on to Dossier;
- set `X-Forwarded-Proto` and append the client's address to `X-Forwarded-For`;
- with nginx, raise `client_max_body_size` to `12m` so imports of up to 10 MB get through.

Never expose port 38470 to your network or the internet: Dossier trusts the `X-authentik-*` headers, so a request that skips Authentik could claim to be anyone.
</details>

## Environment variables

Dossier is configured with environment variables; everything else is set in the app. Put them in `.env` next to `compose.yml`, then run `docker compose up -d` to apply them (a plain restart keeps the old values). The server doesn't start while a required variable is missing or invalid, and its log says which one and how to fix it.

**Required:**

| Variable | What it's for |
|---|---|
| `POSTGRES_PASSWORD` | The database's password. `compose.yml` builds the app's `DATABASE_URL` from it. |
| `DOSSIER_SECRET` | At least 32 random characters. Encrypts saved API keys and signs what Dossier passes around internally; changing it means API keys have to be entered again. |
| `DOSSIER_OWNER` | Your Authentik user name. You keep the main database; everyone else gets their own. Without it, everyone gets their own and the main database goes unused. |

**Optional:**

| Variable | Default | What it's for |
|---|---|---|
| `TZ` | `UTC` | The server's time zone, e.g. `Europe/Berlin`. Nightly backups run at 03:00 in it, and dates the server writes (a letter's date, "today") follow it. |
| `DOSSIER_BACKUP_RETENTION_DAYS` | `14` | How many days of nightly backups to keep. |
| `DOSSIER_TELEMETRY` | ask | `on` or `off` answers the usage ping's question in advance; unset, Dossier asks after sign-in. The ping sends a random install ID and the version number once on each day Dossier is used (see [Privacy](https://github.com/AienTech/dossier/wiki/Privacy)). |
| `DOSSIER_AI_PROVIDER` | none | `local` (Ollama or llama.cpp), `openai` (any OpenAI-compatible API) or `anthropic`. A default for Settings → AI provider; a choice saved there wins. |
| `DOSSIER_AI_URL` | per provider | The AI server's address, e.g. `http://ollama:11434`. |
| `DOSSIER_AI_MODEL` | per provider | The model to use, e.g. `qwen2.5:7b` or `claude-sonnet-5`. |
| `DOSSIER_AI_KEY` | none | The API key for a hosted provider. |
| `DOSSIER_AI_TIMEOUT_SECONDS` | `300` local, `120` hosted | How long one AI request may take. |
| `DOSSIER_JOBS_SOURCE` | off | `jsearch`, `adzuna`, `arbeitsagentur` or `off`. A default for Settings → Job search; a choice saved there wins. |
| `DOSSIER_JSEARCH_KEY` | none | A JSearch key, from OpenWeb Ninja or RapidAPI. |
| `DOSSIER_JSEARCH_HOST` | `openwebninja` | Where that key is from: `openwebninja` or `rapidapi`. |
| `DOSSIER_ADZUNA_APP_ID`, `DOSSIER_ADZUNA_KEY` | none | Adzuna's app ID and key. |
| `DOSSIER_GOOGLE_CLIENT_ID`, `DOSSIER_GOOGLE_CLIENT_SECRET` | none | A Google OAuth client, for Gmail and Calendar (see [Connecting Gmail and Calendar](https://github.com/AienTech/dossier/wiki/Connecting-Gmail-and-Calendar)). A client saved in Settings → Google wins. |
| `DOSSIER_PUBLIC_URL` | the address in use | The address Dossier is reached at, e.g. `https://dossier.example.com`, for Google's redirect after you sign in. Only needed when your proxy doesn't pass on the host and protocol. |
| `<NAME>_FILE` | none | Reads a secret from a file instead, e.g. `DOSSIER_SECRET_FILE=/run/secrets/dossier_secret`. Works for `DATABASE_URL`, `DOSSIER_SECRET`, `DOSSIER_AI_KEY`, `DOSSIER_JSEARCH_KEY`, `DOSSIER_ADZUNA_KEY` and `DOSSIER_GOOGLE_CLIENT_SECRET`. A file keeps the value out of `docker inspect`. |
| `DOSSIER_IMAGE` | `ghcr.io/cladkins/dossier:main` | The image to run: this repository's CI publishes it on every push to `main`, also tagged with the commit SHA. Set a SHA tag to upgrade only when you choose. |
| `DOSSIER_PORT` | `38470` | The port on the server (`127.0.0.1`) that Dossier listens on, for the reverse proxy. |
| `COMPOSE_PROFILES` | none | `ai` runs Ollama as well (see [Local model with Ollama](https://github.com/AienTech/dossier/wiki/Choosing-an-AI-provider)). |

Running the image without the Compose file? Set `DATABASE_URL` (`postgresql://user:password@host:5432/database`) instead of `POSTGRES_PASSWORD`, and mount a volume at `/data`, where nightly backups and zipped PDFs go.

## Signing in with Authentik

Each person signs in with their own Authentik account and gets their own profile, applications, settings, Google connection, backups and AI tasks. Dossier never sees a password.

1. **In Authentik**, create a provider: **Applications → Providers → Create → Proxy Provider**, mode **Forward auth (single application)**, external host `https://dossier.example.com`.
2. **Create an application** for it (**Applications → Applications → Create**) and bind your family group to it under **Policy / Group / User Bindings**, so only that group gets in.
3. **Add the application to your outpost**: **Applications → Outposts**, edit the embedded outpost (or yours), and select it.

Each person's data lives in a database of their own on the same Postgres server, named after the main one (`dossier_u…`). Dossier creates it on their first visit and brings it up to date on every start. The owner (`DOSSIER_OWNER`) keeps the main database.

**Sign out** in the sidebar signs out of Authentik. To remove someone, take them out of the group in Authentik; their data stays in their database until you drop it (`DROP DATABASE "dossier_u…"`).

Shared between everyone: the server's environment variables (`DOSSIER_AI_*`, job source keys, the Google OAuth client). Each person can override them in their own Settings. A person's backups and zipped PDFs go to `/data/users/<id>/`; the owner's stay in `/data`.

### The Claude connector behind Authentik

The Claude connector (**Settings → Claude connector**, see upstream's [Connecting Claude](https://github.com/AienTech/dossier/wiki/Connecting-Claude)) works per person: each person turns it on in their own Settings and connects their own Claude, which only reads their data.

Claude's servers call Dossier directly, without signing in to Authentik; they carry Dossier's own tokens instead. So Authentik has to let those addresses through. In Authentik, edit the Dossier **Proxy Provider** → **Advanced protocol settings** → **Unauthenticated Paths**, and add:

```
^/api/mcp
^/api/oauth/
^/\.well-known/oauth-
```

Leave `/oauth/authorize` out: that's the page where you allow Claude in, and it has to go through Authentik so Dossier knows whose Claude it is. With Nginx Proxy Manager, keep the `proxy_set_header X-Original-URL $scheme://$http_host$request_uri;` line in the `/outpost.goauthentik.io` block of the forward-auth config: it's how Authentik sees which path is asked for.

## Documentation

The [wiki](https://github.com/AienTech/dossier/wiki) has what comes after installing:

- [Choosing an AI provider](https://github.com/AienTech/dossier/wiki/Choosing-an-AI-provider): a hosted model, or a local one with Ollama or LM Studio.
- [Choosing a job source](https://github.com/AienTech/dossier/wiki/Choosing-a-job-source): JSearch or Adzuna (and an unofficial one for Germany), and the job agent.
- [Connecting Gmail and Calendar](https://github.com/AienTech/dossier/wiki/Connecting-Gmail-and-Calendar): your own Google OAuth client, step by step.
- [Connecting Claude](https://github.com/AienTech/dossier/wiki/Connecting-Claude): the Claude connector, in Claude's apps and on the command line. Behind Authentik, also see [The Claude connector behind Authentik](#the-claude-connector-behind-authentik).
- [Backups and restore](https://github.com/AienTech/dossier/wiki/Backups-and-restore): exports, nightly backups and database dumps.
- <a name="upgrading"></a>Upgrading: this fork takes upstream's releases through its own pull requests; then `docker compose pull` and `docker compose up -d` (or Deploy in Komodo). Back up first.
- [Troubleshooting](https://github.com/AienTech/dossier/wiki/Troubleshooting): what the common errors mean, and what to do about them. With Authentik:
  - **Every page shows "Sign in through Authentik":** requests reach Dossier without Authentik's `X-authentik-*` headers. Check that the proxy sends them on (`copy_headers` with Caddy) and that you open Dossier at the address Authentik serves.
  - **Your data is missing after signing in:** `DOSSIER_OWNER` doesn't match your Authentik user name, so you got a new, empty profile. Fix it and run `docker compose up -d`.
- [Privacy](https://github.com/AienTech/dossier/wiki/Privacy): what stays on your server and what leaves it. [PRIVACY.md](PRIVACY.md) has the details.
- [Environment variables](https://github.com/AienTech/dossier/wiki/Environment-variables): every setting the server reads, except that this fork has no `DOSSIER_PASSWORD` and adds the ones in [Environment variables](#environment-variables) above.

## Known limitations

- **Desktop only:** made for a laptop or desktop browser, not for phones.
- **Sign-in needs Authentik:** Dossier has no sign-in of its own; Authentik (or another proxy that sends the same `X-authentik-*` headers) has to sit in front of it.
- **English interface:** the app itself is in English. Documents can be written in other languages; in the 21 built-in ones, their headings, dates and language levels are in that language too, and in one added with **Other language…** those stay in English.
- **One instance:** run a single copy of the app per database. The nightly backups, the AI job queue and the PDF browser live inside the app's process.

## Performance and sizing

Measured on 28 September 2026 with the production build in a container limited to 2 vCPUs and 1 GB:

- **PDFs:** the base resume renders in about 0.25 s, or 1 s when Chromium has to start first (it closes after five idle minutes). Two render at a time and the rest queue: six requested at once are done in 1.4 s. Dossier used at most about 520 MB, Chromium included, so give the container at least 768 MB.
- **Screens:** with ten times the demo data (90 applications), the dashboard and the applications list answer in 20–90 ms, and every query takes under a millisecond. With 900 applications they take up to about 0.2 s, mostly rendering; the tables are indexed for the queries they get.
- **Interactions** (changing a status, moving a card, switching tabs, opening an editor, typing, picking a theme) respond within 32 ms, and within about 100 ms on a CPU four times slower.

## Security

What protects your data, how to run Dossier safely and how to report a problem: see [SECURITY.md](SECURITY.md).

## Development

Working on Dossier itself: see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

Dossier is free software under the [GNU Affero General Public License v3.0](LICENSE). You may use, change and share it; if you run a changed version for others over a network, you must offer them its source code.
