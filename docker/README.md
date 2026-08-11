# Docker dev stack — Dulce María Repostería

> **This is local development only.** It has nothing to do with this
> project's real production deploy. Production runs on **cPanel shared
> hosting** (Node.js app via Passenger + PostgreSQL administered through
> **phpPgAdmin**). There are no containers anywhere in the production path,
> ever. Nothing here should be copied into a deploy process — this stack
> exists purely so contributors can run the whole app locally with one
> command and get hot-reload while editing.

## What's in the stack

| Service | Source folder | Host port | Container port | Purpose |
|---|---|---|---|---|
| `db` | (named volume, no bind mount) | 5434 | 5432 | PostgreSQL 10.23 (matches prod version) |
| `backend` | `Backend/dulcemaria-api` | 4301 | 3000 | Express API, hot-reload via nodemon |
| `frontend` | `Frontend/dulcemaria-web` | 4302 | 3000 | Nuxt 3 admin panel, hot-reload via `nuxt dev` |
| `sitio_web` | `Sitio_web` | 4303 | 3000 | Vite public catalog site, hot-reload via `vite` |

Ports were chosen to avoid every port already in use on a typical dev
workstation for this project (3000, 5000, 5432, 5433, 6379, 8000, 8001,
8025, 1025, etc. from other local stacks). If any of 4301–4303 or 5434 are
already taken on your machine, edit the `ports:` mappings in
`docker-compose.yml` and adjust the corresponding `NUXT_PUBLIC_API_BASE` /
`VITE_API_BASE` / `FRONTEND_URL` values to match.

## Prerequisites

- Docker Desktop (or an equivalent Docker Engine + Compose v2 install)
- Nothing else — Node.js, Postgres, etc. all run inside containers. You do
  **not** need Postgres or Node installed on the host to use this stack.

## First-time setup

```bash
# From the repo root:
cp docker/env.example .env
# (optional) edit .env if you want different local credentials — the
# defaults are fine for local dev, they are clearly-fake placeholders.

docker compose up -d --build
```

Compose auto-loads the root-level `.env` file, which is where
`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_SECRET`,
`BOOTSTRAP_TOKEN`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` come from — see
`docker/env.example` for what each one does.

**Important:** this `.env` (and `docker/env.example`) are separate from,
and unrelated to, the real `.env` / `.env.example` files inside
`Backend/dulcemaria-api` and `Frontend/dulcemaria-web`. Those app-level env
files are not touched by this stack and should not be touched by this
workflow either.

## What happens on first boot

1. `db` starts with an **empty** Postgres 10.23 database (no SQL files are
   mounted into it — this stack does not use
   `docker-entrypoint-initdb.d`-style schema seeding).
2. `backend` waits for `db` to report healthy, then starts. On startup the
   API itself runs `runCompleteMigrations()` (see
   `Backend/dulcemaria-api/src/migrations/complete.js`) before it starts
   listening — this is what actually creates every table, column, index,
   and trigger. It is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD
   COLUMN IF NOT EXISTS`, etc.), so it safely re-runs on every container
   restart.
3. `frontend` and `sitio_web` start their dev servers and point at the API
   through the **host-exposed** backend port (`http://localhost:4301`) —
   not the internal compose service name — because those URLs are read by
   the browser, not by the container network.

At this point the database has schema but no users. To create the first
SUPERADMIN account, use the bootstrap endpoint (the repo's own `npm run
seed:superadmin` script is broken — it requires `@prisma/client`, which
isn't installed in this project — so this is the supported path for local
dev):

```bash
curl -X POST http://localhost:4301/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "token": "'"$BOOTSTRAP_TOKEN"'",
    "email": "'"$ADMIN_EMAIL"'",
    "password": "'"$ADMIN_PASSWORD"'"
  }'
```

(or just substitute the literal values you set in `.env` — by default,
`local-dev-bootstrap-token-change-me`, `admin@dulcemaria.local`, and
`ChangeMe123!`).

Then log in through the admin panel at http://localhost:4302 with that
email/password.

## URLs

- Public catalog site: http://localhost:4303
- Admin panel (Nuxt): http://localhost:4302
- API: http://localhost:4301
- Postgres (for a local client like pgAdmin/DBeaver, **not** phpPgAdmin —
  that's the production-only tool): `localhost:5434`, db/user/password
  from your `.env`

## Applying schema changes later

Schema is owned entirely by
`Backend/dulcemaria-api/src/migrations/complete.js`, which runs on every
`backend` boot. To pick up a new migration statement you added there,
just restart the backend container:

```bash
docker compose restart backend
```

No manual SQL, no separate migration-runner command — the migrations
re-run idempotently every time the container starts.

## Hot reload

- `backend`: bind-mounted, runs `nodemon` (see `nodemon.json` —
  `legacyWatch`/polling enabled since Docker bind mounts on Windows/WSL
  don't reliably deliver native filesystem events). Edit any file under
  `Backend/dulcemaria-api` and nodemon restarts the process automatically.
- `frontend`: bind-mounted, runs `nuxt dev --host 0.0.0.0` with Vite
  polling enabled in `nuxt.config.ts`. Edit any file under
  `Frontend/dulcemaria-web` and the page hot-reloads.
- `sitio_web`: bind-mounted, runs `vite` with polling enabled in
  `vite.config.js`. Edit any file under `Sitio_web` and the page
  hot-reloads.

`node_modules` for each service is an **anonymous volume**, not part of the
bind mount — this keeps the Linux-container `npm install` output isolated
from whatever you have installed on the host, so a Windows-native
`node_modules` never collides with the container's.

## Resetting the stack

```bash
docker compose down -v
```

The `-v` flag also drops the named volumes (`dulcemaria_db_data` and the
three `node_modules` volumes), so the next `docker compose up -d --build`
starts completely fresh — empty database, clean dependency install.

## Reminder

Again: **this is local development only.** It has nothing to do with this
project's real production deploy, which is cPanel shared hosting with
PostgreSQL administered through phpPgAdmin. Do not port anything from this
stack into a production workflow.
