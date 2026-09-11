# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

The git root is `Dulce-Maria-Reposteria/` (nested one level under the `DulceMaria/` folder you may open first). It holds **three independent apps** plus a dev-only Docker stack. Each app has its own `package.json` and is installed and run separately; the frontends talk to the API over HTTP and never import backend code.

| Path | Role | Stack |
|---|---|---|
| `Backend/dulcemaria-api/` | The only backend — REST API | Express 4, CommonJS, Node 20, raw `pg`, PostgreSQL 10.23 |
| `Frontend/dulcemaria-web/` | Admin dashboard (private portal) | Nuxt 3 SPA (`ssr: false`), Vue 3, TypeScript, Tailwind, Chart.js |
| `Sitio_web/` | Public storefront (landing + catalog + cart + checkout) | Vanilla ES modules, Vite, statically-compiled Tailwind — **no framework** |

## Commands

### Backend — `Backend/dulcemaria-api/`
- `npm run dev` — nodemon (polling watch, see `nodemon.json`)
- `npm start` — `node server.js`
- `npm run db:validate` — check the live DB against the canonical schema
- Migrations run **automatically on every boot** — there is deliberately no migrate command (see *Schema is code* below)
- First admin user: created automatically on startup when `NODE_ENV != production` and the `users` table is empty, from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (`src/bootstrap/autoSuperadmin.js`; disable with `AUTO_BOOTSTRAP_SUPERADMIN=false`). Manual fallback / production path: `POST /auth/bootstrap?token=<BOOTSTRAP_TOKEN>` — the token is a query param and the credentials come from the backend env, not the request body
- `db:init` and `seed:superadmin` are legacy and broken (`seed:superadmin` needs `@prisma/client`, which is not installed) — do not use them

### Admin frontend — `Frontend/dulcemaria-web/`
- `npm run dev` (port 3000) · `npm run build` · `npm run generate` (static output) · `npm run preview`

### Public site — `Sitio_web/`
- `npm run dev` (Vite, port 3000) · `npm run build` · `npm run preview`
- Tailwind is compiled, never the CDN: `npx tailwindcss -i css/input.css -o css/styles.css --watch`

### Whole stack locally (Docker — dev convenience only)
- `cp docker/env.example .env` at the repo root, then `docker compose up -d --build`
- Ports: API `4301`, admin `4302`, public site `4303`, Postgres `5434`
- `docker compose restart backend` re-runs migrations after you edit the schema
- This stack is **not** how the project deploys (see *Deployment*)

There is no test suite. The `*.rest` files at the repo root are for manual API poking.

## Backend architecture

**Entry point `server.js`** builds one `apiRouter` and mounts it at **both `/` and `/dulcemaria`** (Passenger robustness on cPanel). On startup it validates env (`src/config/env.js`), runs `runCompleteMigrations()`, then listens — a failed migration exits the process.

**Routing** — `src/routes/{public,admin}.<resource>.js`, registered in `server.js`. Everything under `/admin/*` is gated by `requireAuth` + `adminApiLimiter`; public routes get `publicApiLimiter`.

**Auth** (`src/middleware/auth.js`):
- `requireAuth` — verifies the JWT Bearer token, sets `req.user = { sub, email, role }`
- `requireRole(...roles)` — roles are `SUPERADMIN`, `ADMIN`, `STAFF`
- `requirePlatformOwner` — matches `req.user.email` against `PLATFORM_OWNER_EMAIL` **only**, never falling back to role. It gates `/admin/platform-fees/*` (the "Motor de Tarifa"), which is the platform vendor billing this bakery instance. The bakery owner must never see it, even as `SUPERADMIN`.

**Schema is code** — `src/migrations/complete.js` is the single canonical schema definition. Every statement is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, …) and re-runs on every boot. To change the schema, add idempotent statements there. Never hand-edit the database and never add a separate migration runner. `prisma/schema.prisma` and the `sql/*.sql` files are **not** the source of truth — Prisma is not wired into the app. `DULCEMARIA_BACKEND_PLAN_Y_ESQUEMA.md` documents the intended schema in prose.

**Money** is always integer Chilean pesos in `*_clp` columns and fields. No floats, no decimals.

**Domain business logic** lives in `src/lib/`, not in routes:
- `recipeCost.js` — recipe costing: ingredient cost, scaling by mold diameter/height/layers, labor minutes × rate, equipment energy cost, profit margin
- `platformFeeEngine.js` — `evaluateAndChargeFee(client, order)` charges the platform fee when an order reaches `DELIVERED`. It **must be called inside the same Postgres transaction** as the status change. Idempotent via `INSERT … ON CONFLICT (order_id) DO NOTHING`. The fee tier depends on the calendar month's accumulated volume (`America/Santiago`) and is never recomputed retroactively. It never throws on missing config — it falls back to `system_config.platform_fee_default_clp`.
- `units.js` — unit conversion and `VALID_UNITS`

**Conventions** — JSON responses are `{ ok: true, ... }` / `{ ok: false, error }`. Request bodies are validated with `zod` per route. Uploads go through `multer` to `uploads/`, served at `/uploads` and `/dulcemaria/uploads` with `Cross-Origin-Resource-Policy: cross-origin` (max 8 images/request, 10 MB each).

**Env vars** — `DATABASE_URL` and `JWT_SECRET` (≥ 32 chars) are required. Also used: `PORT` (default 3000), `FRONTEND_URL` (comma-separated CORS allowlist), `BOOTSTRAP_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PLATFORM_OWNER_EMAIL`.

## Admin frontend architecture

Nuxt 3 in **SPA mode** (`ssr: false`). Pages under `pages/dashboard/*` use `layouts/dashboard.vue`. The auth token is a JWT in `localStorage` under `auth_token` (with `user` alongside); `middleware/auth.ts` redirects to `/login` when it is missing (client-only). All API calls go through `composables/useApi.ts`, which injects the Bearer header and forces a logout on `401`. The API base is `runtimeConfig.public.apiBase` in `nuxt.config.ts` (override with `NUXT_PUBLIC_API_BASE`). Charts use `vue-chartjs`.

## Public site architecture and constraints

Plain ES modules loaded with `<script defer>` from `index.html`: `config.js` (defines `API_BASE` from `VITE_API_BASE`) first, then `catalog.js`, `cart.js`, `carousel.js`, `hero.js`, `cake-builder.js`. Built with Vite; Tailwind is compiled to `css/styles.css`, never the CDN.

This site runs under a **strict Content-Security-Policy**. The following break it and are disallowed (enforced by the project rules in `.windsurfrules`):
- `eval()`, `new Function()`, `setTimeout` / `setInterval` with a string argument
- Inline event handlers (`onclick`, `onerror`, `onchange`, …) — attach with `addEventListener` after render instead
- Inline `<script>` without a nonce, and the **Tailwind CDN** (it uses `new Function` internally)

Patterns to follow instead:
- **Event delegation** on a stable parent using `data-*` attributes (e.g. `container.addEventListener('click', e => { const btn = e.target.closest('[data-qty-delta]') })`) — never attach listeners directly to elements built via `innerHTML`
- Dynamic `<img>`: add `data-img-fallback` / `data-cart-img` and handle `addEventListener('error', …)` after render, not inline `onerror`
- Every fetch uses `` `${API_BASE}/…` `` — never hardcode `api.dulcemaria.hrcastell.com`
- Stock with variants: `totalStock` is the sum of active variants; disable add-to-cart when it is `0`; the variant selector updates price and stock live
- Payment flow (`cart.js`): step 1 is the customer form, step 2 is confirmation with a WhatsApp link. Element IDs: `payment-modal-{confirm,cancel,close}`, `payment-step-{1,2}`, `order-number-display`, `whatsapp-confirm-link`

## Deployment (context, not a task)

Production is **cPanel shared hosting** — the backend runs as a Node.js app under Passenger, PostgreSQL 10.23 is administered through phpPgAdmin, and the frontends are uploaded as built output. **There are no containers in production, ever.** `docker-compose.yml`, the `Dockerfile`s, and `docker/` are strictly local dev. See `Backend/dulcemaria-api/INSTALL_CPANEL.md` and `INSTRUCCIONES_HOSTING_COMPARTIDO.md`.

## Conventions

- Code comments, documentation, and commit messages are written in **Spanish**. Commits follow Conventional Commits (`feat:`, `fix:`, …).
- Editor rules live in `.windsurfrules` (Windsurf). There is no Cursor or Copilot config.
- `.codegraph/` and `.atl/` are per-checkout indexes and are gitignored.
