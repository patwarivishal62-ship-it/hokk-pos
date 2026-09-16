# HOKK Product Operations System

Internal master catalog for **HOUSE OF KALA KATHA** — *Stories of India, Woven for You*.

One source of truth for every product before it reaches Shopify: information, handloom
provenance, naming, photography, content, measurements, review and approval, then a
validated Shopify CSV export. Nothing reaches Shopify unreviewed.

## Stack

Next.js 15 (App Router, React Server Components + server actions) · TypeScript strict ·
`node:sqlite` with hand-written SQL (`db/schema.sql`) · Tailwind 3.4 · Zod · Vitest.

No ORM. Node ≥ 22.5 is required because the data layer uses the built-in `node:sqlite`
module. PostgreSQL remains a provider swap behind `src/lib/db` if the catalog outgrows
SQLite.

## Getting started

```bash
npm install
npm run db:init     # apply db/schema.sql
npm run bootstrap   # seed roles, settings, slot templates, Shopify mapping + first super admin
npm run dev         # http://localhost:3000
```

`npm run bootstrap` reads `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and `SEED_ADMIN_NAME`
from `.env` (copy `.env.example`). It refuses the placeholder password. If you skip it,
the app offers a one-time `/setup` screen for the first account.

The seed creates **system configuration only** — roles, settings defaults, the three
image-slot templates, attribute-field definitions and the Shopify column mapping. No
products, categories, cultures or collections are seeded; the catalog starts empty and
the team builds it.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:3000` |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — 22 files, 315 tests |
| `npm run db:init` | Idempotent schema apply |
| `npm run bootstrap` | Seed system config + super admin |
| `npm run e2e` | End-to-end pipeline smoke test against the real database |
| `npm run render:verify` | Render disk, upload round trip and public image URL |

`npm run e2e` creates a throwaway category, culture, collection and product, fills the
mandatory fields, uploads an image into every required slot, checks the workflow gate,
runs a Shopify export and validates the CSV headers — then cleans up after itself
(`E2E_KEEP=1` retains the data). It calls the same functions the server actions call, so
it exercises shipping code paths rather than a re-implementation.

## How the pipeline works

`DRAFT → INFORMATION REQUIRED → INFORMATION COMPLETE → PHOTOGRAPHY REQUIRED →
PHOTOGRAPHY COMPLETE → CONTENT REVIEW → INTERNAL REVIEW → FOUNDER APPROVAL →
SHOPIFY READY → EXPORTED → PUBLISHED`, plus request-changes, reject, return and archive.

Transitions are data, not branches: `src/lib/workflow.ts` holds a
`Record<ProductStatus, TransitionRule[]>` where each rule carries the permission it
needs, whether it requires a ready product, and whether a comment is mandatory.

Two engines gate the pipeline:

- **Completeness** (`src/lib/completeness.ts`) — 11 sections, required fields weigh 1 and
  recommended 0.5, explicit "information required" markers always count against the
  product. Handloom-only fields apply only when the product resolves to the SAREE
  template, so saree fields are never demanded of a T-shirt.
- **Shopify readiness** (`src/lib/readiness.ts`) — enumerated ERROR and WARNING checks.
  Errors block; warnings need an explicit admin override at export time. The state is
  `BLOCKED` / `WARNINGS` / `READY` and drives whether `SHOPIFY READY` is reachable.

## Design decisions worth knowing

- **SKU** is generated from a configurable pattern (`HOKK-{TYPE}-{CULTURE}-{SEQ}`), unique,
  searchable and immutable for anyone without `product.sku.edit`. The display name is
  never used as an identifier.
- **Naming** is its own workflow. Content proposes, reviewer or admin approves, the
  history is retained, and a product is never auto-named "Saree 001".
- **Missing cultural information is never guessed.** An unknown handloom culture stays
  unknown and surfaces on the missing-information dashboard as
  `MISSING — INFORMATION REQUIRED`.
- **Attribute fields, image slots, size-guide columns, roles, permissions, units and the
  Shopify column mapping are all database rows.** None of it is hard-coded in the UI, and
  no role name is ever tested in the frontend — permission keys are checked instead.
- **Images** are filed into two folders: **Original** for raw photographs and **Final**
  for approved, export-ready assets. Filenames are generated as
  `HOKK-SAR-ZK-001-HERO.jpg` so nothing depends on the display name.

## Shopify export

The export is **mapping-driven**: `src/lib/shopify/schema.ts` ships two presets —
`shopify-product-csv` (the current Shopify template, default) and
`shopify-product-csv-legacy` — and the columns actually written come from the
`shopify_field_mapping` table, editable under Settings. When Shopify changes its
template, apply a preset or edit the mapping; no deploy needed.

Current-template headers are the modern ones — `URL handle`, `Description`, `Price`,
`Product image URL`, `Published on online store` — not the legacy `Handle` /
`Body (HTML)` / `Variant Price` / `Image Src`.

**Images must be at publicly reachable URLs.** Shopify fetches `Product image URL` with
no credentials. When no public URL exists the CSV leaves the column blank and the export
records the warning *"Images cannot be imported into Shopify until publicly accessible
URLs are available."* Local paths are never presented as if they worked.

Exports produce a preview (selected / ready / blocked / warnings), a history row with the
schema version, and both a Shopify CSV and an internal multi-sheet Excel workbook.

## Storage

Two backends, switchable per deployment (`STORAGE_BACKEND` env var or Settings
→ Storage; env wins when set):

- **LOCAL** (default) — uploads land in `original/<SKU>/<file>` and
  `final/<SKU>/<file>` under `UPLOAD_DIR` and are served publicly at
  `/api/media/<key>`. That route is deliberately unauthenticated because Shopify
  must be able to fetch `Product image URL` with no credentials. The app derives
  that URL from the current request's forwarded HTTPS host automatically;
  `PUBLIC_BASE_URL` (or `storage.public_base_url` in Settings) is only needed to
  force a different custom domain. Note *local* means the machine running the
  app — on a laptop, other devices cannot see those photos.
- **CLOUDINARY** — uploads go to a free Cloudinary account instead, so every
  device views the same online copy the moment an upload finishes, and Shopify
  imports the same public URLs. Rows remember their own backend, so existing
  local photos keep serving until migrated from Settings → Cloud storage tools.
  Five-minute setup: `CLOUD_STORAGE.md`.

For the product data itself (the SQLite file), point every device at one shared
online database — free Turso via `DATABASE_URL=libsql://…` + `TURSO_AUTH_TOKEN`
— also covered in `CLOUD_STORAGE.md`. Alternatively deploy once on Render and
have the whole team log into that URL.

On **Render** (`render.yaml`) everything sits on a **persistent disk** mounted at
`/var/data`: uploads in `/var/data/storage/uploads`, exports in
`/var/data/storage/exports`, SQLite in `/var/data/hokk.db`. The app detects
Render's environment and defaults every path onto that disk, builds image URLs
from the forwarded request host (with `RENDER_EXTERNAL_HOSTNAME` as a fallback)
(override with `PUBLIC_BASE_URL` for a custom domain), and **refuses to boot when
no disk is actually mounted** — the error screen explains the fix rather than
letting a deploy silently lose every photograph. `npm run render:verify` proves
the disk, the locations and a real upload round trip; `GET /api/health` reports
the same facts as JSON and backs the Blueprint's health check. Full walkthrough:
`RENDER.md`.

## Layout

```
db/schema.sql            31 tables, idempotent DDL
src/lib/                 domain logic — workflow, completeness, readiness, sku, handle,
                         images, storage adapters, csv, shopify schema + builder,
                         exporter, importer, rbac, audit, session, auth
src/app/actions/         server actions (every export is an async function)
src/app/(app)/           authenticated pages: dashboard, products, photography, content,
                         reviews, collections, categories, cultures, size-guides,
                         exports, imports, users, roles, audit, settings, account
src/app/api/             media streaming + export downloads + /api/health
scripts/                 db-init, bootstrap, e2e, render verification (via tsx)
tests/                   315 unit + integration tests
```

## Assumptions flagged during the build

The original brief was truncated mid-section 48, so these were designed from the
patterns in sections 1–47 and are worth reviewing:

- **Collection workspace** merges the customer-collection, category and culture views onto
  one page, with drag-to-reorder for customer collections.
- **Notifications** are implemented as per-user pending task queues (Photography, Content,
  Review) plus an "assigned to me" dashboard card, rather than push or email.
- **Import** supports NEW / UPDATE / FULL modes, matching on SKU or handle, with the
  upload → detect → map → preview → validate → flag-duplicates → import sequence.

## What has actually been verified

Checked on a clean checkout, not assumed:

- `npx tsc --noEmit` — 0 errors.
- `npx vitest run` — 22 files, 315 tests, all passing.
- `npm run build` — clean production build, 28 routes.
- `npm run e2e` — full pipeline against a real SQLite file: SKU generation, completeness,
  readiness, image slots, workflow gating, and a Shopify CSV export read back and asserted
  column by column.
- All 18 authenticated pages fetched over HTTP with a session cookie and returned 200; the
  12 product-detail tabs likewise. Tampered and absent cookies redirect to `/login`.
- The login path itself is covered by `tests/session.test.ts` (14 tests) and
  `tests/auth-actions.test.ts` (12 tests), which drive the real `createSession` →
  `getSessionUser` → `authenticate` → `loginAction` sequence, plus tampering, revocation,
  expiry and account deactivation.
- The full login chain was exercised over real HTTP: the real `loginAction` writing a cookie
  through Next's own cookie store, then that exact `Set-Cookie` authenticating
  `/dashboard`, `/products`, `/audit` and `/settings`.

### Deploying to Render

`render.yaml` provisions a web service with a 10 GB persistent disk at `/var/data`; the
host-aware defaults in `src/lib/hosting.ts` put uploads, exports and the SQLite file on
that disk and derive the public image base URL from each request's forwarded host (with
Render hostname metadata as a fallback). Render's filesystem outside a disk is erased on
every deploy, so `checkBoot()` fails with an
explicit "Persistent disk is not attached" screen (with the fix, and the
`ALLOW_EPHEMERAL_STORAGE=1` opt-out) instead of losing data quietly. `npm run render:verify`
checks the mount, the writability of every path, a byte-exact upload round trip and an
anonymous fetch of the resulting `/api/media/<key>` URL. Step-by-step: `RENDER.md`.

### Serving behind a proxy

Every form in this app is a Server Action, and Next.js aborts a Server Action whose `Origin`
header does not match `x-forwarded-host`/`host` with `Invalid Server Actions request.`
(HTTP 500). Behind a reverse proxy or preview host those differ, which breaks **login** —
not merely uploads. `next.config.mjs` therefore feeds `ALLOWED_ORIGINS` into both
`serverActions.allowedOrigins` and `allowedDevOrigins`, defaulting to `*.e2b.app`. Set it to
your real domain in production.

This was verified rather than assumed: a request from an allowlisted origin reaches the
action, while one from a non-allowlisted origin is still rejected with
`Invalid Server Actions request.`, so the CSRF protection is intact.

A note on how the suite is organised, because it matters when adding to it: `scripts/e2e.ts`
drives the library layer directly and does **not** authenticate. Anything that only breaks
behind a session cookie — the request/auth boundary, cookie handling, `next/headers` — is
invisible to it, and `tsc` and `next build` cannot see it either. That combination let a
broken login survive an otherwise green run. New request-boundary behaviour needs a test in
the Vitest suite, not just an E2E assertion.
