#!/bin/sh
# The production container's command (E12-3): bring the database up to date,
# load the built-in themes, then serve. If a step fails, the container stops
# with a non-zero exit code, so CapRover and Docker don't switch over to it.
set -eu

# DATABASE_URL may come from a file (a Docker secret); Prisma's CLI reads the
# variable itself, so read the file for it.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${DATABASE_URL_FILE:-}" ]; then
  DATABASE_URL="$(cat "$DATABASE_URL_FILE")"
  export DATABASE_URL
fi

cd /app/tools
if ! node node_modules/prisma/build/index.js migrate deploy; then
  echo "Dossier didn't start: applying the database migrations failed (see the error above). See \"A migration failed\" in the README's troubleshooting section." >&2
  exit 1
fi
if ! node seed.mjs; then
  echo "Dossier didn't start: loading the built-in themes failed (see the error above)." >&2
  exit 1
fi

cd /app
exec node server.js
