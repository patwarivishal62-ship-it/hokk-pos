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
| `npm test` | Vitest — 17 files, 244 tests |
| `npm run db:init` | Idempotent schema apply |
| `npm run bootstrap` | Seed system config + super admin |
| `npm run e2e` | End-to-end pipeline smoke test against the real database |

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

`STORAGE_BACKEND` selects `LOCAL` or `GDRIVE`.

- **LOCAL** writes under `UPLOAD_DIR` and serves files at `/api/media/<key>`. That route is
  deliberately unauthenticated because Shopify must be able to fetch it; set
  `PUBLIC_BASE_URL` so the generated URLs are reachable from outside.
- **GDRIVE** creates **Original** and **Final** folders under a configured parent, uploads
  via the Drive REST API, shares each file as "anyone with the link" and stores the public
  URL. Credentials come from `GDRIVE_SERVICE_ACCOUNT_JSON` (or `_FILE`, base64 allowed) or
  `GDRIVE_CLIENT_ID` + `GDRIVE_CLIENT_SECRET` + `GDRIVE_REFRESH_TOKEN`. Settings → Storage
  has a **Test connection** action that creates the folders and saves their ids.

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
src/app/api/             media streaming + export downloads
scripts/                 db-init, bootstrap, e2e (run through tsx)
tests/                   168 unit + integration tests
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
- **Google Drive could not be verified live** in this environment — no credentials were
  available. The adapter is implemented against the documented Drive v3 REST API and is
  covered by unit tests with a stubbed transport, but it has not been exercised against a
  real Drive account.

## What has actually been verified

Checked on a clean checkout, not assumed:

- `npx tsc --noEmit` — 0 errors.
- `npx vitest run` — 17 files, 244 tests, all passing.
- `npm run build` — clean production build, 26 routes.
- `npm run e2e` — full pipeline against a real SQLite file: SKU generation, completeness,
  readiness, image slots, workflow gating, and a Shopify CSV export read back and asserted
  column by column.
- All 18 authenticated pages fetched over HTTP with a session cookie and returned 200; the
  12 product-detail tabs likewise. Tampered and absent cookies redirect to `/login`.
- The login path itself is covered by `tests/session.test.ts`, which drives the real
  `createSession` → `getSessionUser` → `authenticate` sequence, plus tampering, revocation,
  expiry and account deactivation.

Not verified: the **Google Drive** storage backend, for the credential reason given above.

A note on how the suite is organised, because it matters when adding to it: `scripts/e2e.ts`
drives the library layer directly and does **not** authenticate. Anything that only breaks
behind a session cookie — the request/auth boundary, cookie handling, `next/headers` — is
invisible to it, and `tsc` and `next build` cannot see it either. That combination let a
broken login survive an otherwise green run. New request-boundary behaviour needs a test in
the Vitest suite, not just an E2E assertion.
