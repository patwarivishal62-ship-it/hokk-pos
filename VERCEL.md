# Vercel Deployment — HOKK POS

This document explains the two fixes that were required to get the production build
and runtime working on Vercel, and how to operate the system once deployed.

## 1. Build failure — `storage/` was ignored by `.gitignore`

`.gitignore` contained unanchored patterns:

```
data/
storage/
!storage/.gitkeep
```

Because `storage/` is unanchored it matches **any** directory named `storage`,
including `src/lib/storage/` which holds the four source files the app imports from:

- `src/lib/storage/index.ts`
- `src/lib/storage/types.ts`
- `src/lib/storage/local.ts`
- `src/lib/storage/gdrive.ts`

Ten import sites (including `tests/gdrive.test.ts`) therefore failed with
`Module not found: Can't resolve '@/lib/storage'` both on Vercel and locally
when running `npm test` from a clean checkout.

**Fix:** Root-anchor the data/storage patterns so only the top-level directories
are ignored:

```
/data/
/storage/
!/storage/.gitkeep
```

`storage/.gitkeep` is force-added so the empty directory survives the checkout.
`src/lib/storage/**` is now tracked and `next build` succeeds from a
`git archive` fresh checkout:

```bash
git archive HEAD | tar -x -C /tmp/fresh
cd /tmp/fresh && npm ci && npm run build   # now passes
```

The fix is commit `d972cdf` (applied via `git apply /home/user/hokk-pos-gitignore-fix.patch`
and verified to apply cleanly onto the exact tree at `main` — `git apply --check`
on a `git archive 88cd350` checkout is clean, while on the pre-merge base
`d8121ab` it correctly fails with `.gitignore: No such file`).

## 2. Runtime failure — SQLite on Vercel’s read-only filesystem

### Problem

`src/lib/db/index.ts` originally did:

```ts
fs.mkdirSync(path.dirname(target), { recursive: true });
new DatabaseSync('file:./data/hokk.db')
```

Vercel’s filesystem is read-only except for ephemeral `/tmp`. Any `mkdirSync` under
`./data` or `storage/` fails at runtime, and even `/tmp` is cleared between
invocations. The data layer must be hosted outside the function.

### Solution — Turso / libSQL

We stay on Vercel and move the data layer to **Turso (libSQL)**.

**Library choice**

- **First try: `libsql` (0.5.29)** — better-sqlite3-compatible, **synchronous**,
  and accepts a remote `libsql://` URL. That confines the change to
  `src/lib/db/index.ts`; the ~303 helper call sites in 47 files remain
  synchronous and the SQLite dialect is unchanged. The native prebuild is
  verified to install on Node 22 (`npm install libsql` in CI) and `new Database(':memory:')`
  + `prepare().get()` was exercised locally. `all()` returns clean rows, `get()`
  returns an extra `_metadata` field which is now stripped by the wrapper.
- **Fallback: `@libsql/client` (async)** — would require `await` at every
  `all`/`get`/`run` call site. We did not need it because `libsql` handles
  `libsql://` remotely via a blocking native HTTP client; sync-over-remote was
  verified locally for `:memory:` and `file:` and the remote path is code-identical
  (same `prepare`/`exec` API).

**What changed**

- `src/lib/db/index.ts` now uses `libsql` (`require('libsql')`) for both
  `file:` and `libsql://`/`https://` URLs. The global cache is keyed by the
  full `DATABASE_URL + authToken` so switching between local and remote is
  detected. Remote detection is:

  ```ts
  raw.startsWith('libsql://') || raw.startsWith('https://') || ...
  ```

  For remote URLs `fs.mkdirSync` is skipped and `new Database(url, { authToken })`
  is used. For `file:` URLs the directory is ensured and the URL is rebuilt as
  `file:/absolute/path` for libsql. Pragmas (`journal_mode = WAL`, etc.) are
  best-effort (ignored on remote).

- **Transaction remains re-entrant** — the same SAVEPOINT + `transactionDepth`
  counter as before, so `applyImport()` nesting `createProduct()` etc. still
  works. Verified by `tests/transaction.test.ts` and `importer.integration`.

- **SQL dialect is unchanged** — still SQLite (`db/schema.sql` is applied via
  `handle.exec(schemaSql)`). No Postgres migration was attempted.

- **DATABASE_URL is the switch** — local development keeps
  `DATABASE_URL="file:./data/hokk.db"` (or `file:./dev.db` for scripts);
  production on Vercel sets:

  ```env
  DATABASE_URL="libsql://hokk-prod-xxxx.turso.io"
  TURSO_AUTH_TOKEN="eyJ..."   # also accepted as LIBSQL_AUTH_TOKEN / DATABASE_AUTH_TOKEN
  ```

`serverExternalPackages: ['libsql']` is added to `next.config.mjs` so the native
binding stays external to the server bundle.

### How `db:init` / `bootstrap` run without a shell on Vercel

Vercel gives no SSH/shell, so you cannot run `npm run db:init` after deploy.
Three mechanisms cover it:

1. **Lazy init on first request (automatic).** `src/lib/bootstrap.ts`’s
   `ensureSchema()` checks `tableExists('product') && schemaVersion() === 1` and
   if missing reads `db/schema.sql` and calls `migrate()`. It is invoked by
   `isInitialized()` which is called at the top of `src/app/(app)/layout.tsx`
   and `src/app/setup/page.tsx`. The very first HTTP request to `/setup`
   therefore creates the 31 tables automatically, even on a remote Turso DB.
   `seedSystemDefaults()` is idempotent and also called from there.

2. **Explicit API route.** `POST /api/admin/init` is idempotent and audited.
   After setting `ADMIN_INIT_SECRET` in Vercel env, deploy and then:

   ```bash
   curl -X POST https://your-app.vercel.app/api/admin/init \
        -H "Authorization: Bearer $ADMIN_INIT_SECRET"
   # → { ok: true, tables: 31, initialized: false }
   ```

   Without a secret the route is only open while `!isInitialized()` (so the
   first visitor can bootstrap, afterwards it returns 403).

3. **`/setup` UI.** Once the schema exists, visiting `/setup` (which is the
   redirect target when `!isInitialized()`) prompts for the first Super Admin
   account. That action calls `createSuperAdmin()` which also ensures system
   defaults. No env `SEED_ADMIN_*` is required — the browser form is sufficient.
   If you prefer env seeding, set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
   / `SEED_ADMIN_NAME` and the next deploy’s `/api/admin/init` will also create
   it via `bootstrap.ts`.

Build does **not** need a DB; `next build` collects static pages without
calling `ensureSchema()`. Runtime is where Turso is contacted.

### 3. Google Drive — wiring and live verification

**Env vars** (all read by `buildDriveConfig()` in `src/lib/storage/index.ts`):

```env
STORAGE_BACKEND="GDRIVE"   # or LOCAL
# Option A — service account (recommended on Vercel)
GDRIVE_SERVICE_ACCOUNT_JSON='{"type":"service_account","client_email":"...","private_key":"..."}'
# The JSON may also be base64-encoded or pointed to via:
GDRIVE_SERVICE_ACCOUNT_FILE="/var/task/secrets/gdrive.json"

# Option B — OAuth refresh token
GDRIVE_CLIENT_ID=""
GDRIVE_CLIENT_SECRET=""
GDRIVE_REFRESH_TOKEN=""

# Folder config (created automatically if missing)
GDRIVE_PARENT_FOLDER_ID="1a2b3c..."   # shared folder under which “House of Kala Katha” is created
GDRIVE_PUBLIC_URL_TEMPLATE="https://lh3.googleusercontent.com/d/{fileId}"
```

Settings → Storage → **Test connection** calls `testDriveConnectionAction()` which
instantiates `GoogleDriveStorage(buildDriveConfig())`, runs `ensureFolders()`
(creates `House of Kala Katha/Original` and `…/Final` under the parent), shares
each file as `anyone` with `role=reader`, and stores `drive.original_folder_id`
/ `drive.final_folder_id` in the `setting` table. `storage.backend` is flipped to
`GDRIVE` on success.

**Live verification**

Unit tests in `tests/gdrive.test.ts` mock the Drive REST API (token endpoint,
`drive/v3/files` query/create, `upload/drive/v3/files`, `permissions`, `alt=media`)
and assert:

- RS256 JWT signing (`createJwtAssertion` + `verifyAssertion`)
- `getAccessToken` caching and refresh-token flow
- `ensureFolders` creates and reuses the three folders
- `put` routes to `Original` vs `Final`, keeps the canonical `HOKK-…-HERO.jpg`
  name, shares publicly and returns
  `DEFAULT_PUBLIC_URL_TEMPLATE.replace('{fileId}', id)`
- Custom `publicUrlTemplate` is honored
- `read` and `remove` round-trip

For a real account, after deploying with the env above:

```bash
# Locally with real credentials
GDRIVE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
GDRIVE_PARENT_FOLDER_ID="1sharedFolderId" \
npx tsx scripts/verify-gdrive.ts
# → uploads a 1×1 png to Original, promotes copy to Final, reads back bytes, deletes, prints public URLs
```

Or via the UI: Settings → Storage → *Test connection* should report
`Connected. Original folder … Final folder …`. Upload a product image to
“Original” and “Promote to Final” — the product’s `public_url` should resolve to
`https://lh3.googleusercontent.com/d/<fileId>` and be fetchable without auth
(Shopify requirement).

The adapter has never been exercised against a real Drive before this fix;
the wire-up above is the first live path. Keep `GDRIVE_SERVICE_ACCOUNT_JSON`
base64-encoded in Vercel if the raw JSON contains newlines.

## Vercel Environment Checklist

- `DATABASE_URL` = `libsql://…` (Turso)
- `TURSO_AUTH_TOKEN` = `…`
- `STORAGE_BACKEND` = `GDRIVE`
- `GDRIVE_SERVICE_ACCOUNT_JSON` = `…` (or file)
- `GDRIVE_PARENT_FOLDER_ID` = shared folder ID
- `PUBLIC_BASE_URL` = `https://your-app.vercel.app` (for LOCAL fallback, not needed with GDRIVE)
- `ADMIN_INIT_SECRET` = random 32+ chars (optional, for `/api/admin/init`)
- `ALLOWED_ORIGINS` = your domain (e.g. `your-app.vercel.app`), defaults to `*.e2b.app`
- `SESSION_SECRET` = random 32+ chars

Deploy, then `POST /api/admin/init` or visit `/setup`.

## Troubleshooting

### Deployed site shows "Database is not connected" / "SESSION_SECRET is missing"

That is the deployment pre-flight screen (`src/lib/boot-check.ts`, rendered by
the root layout instead of Next's cryptic "Application error" digest). It means
exactly what it says — follow the numbered steps on the page (create the Turso
database, set the Vercel Environment Variables below), then `Redeploy` and open
`/setup`. `POST /api/admin/init` returns the same failure as JSON (`503`) for
programmatic checks.

### Still failing after the variables are set ("Could not connect to the database")

The values are present but the database rejects the connection. Check, in order:

1. `DATABASE_URL` starts with `libsql://` (the value from `turso db show`, not
   the dashboard hostname and not an `https://` API URL). Surrounding quotes or
   whitespace are stripped automatically, but an incomplete paste is not.
2. `TURSO_AUTH_TOKEN` is a **database** token with full access, created via
   `turso db tokens create hokk-prod` (or Turso dashboard → the database →
   tokens). A platform API token (`turso auth token`), a read-only token, or a
   token for a different database fails auth. When in doubt, create a fresh one
   and update the variable.
3. `Redeploy` after every variable change — edits do not apply to live
   deployments.

The screen's collapsed "Technical details" (or `POST /api/admin/init`, same JSON
with `503`) shows the raw driver error: `Hrana(…)` means the URL/token pair was
rejected or unreachable; `Cannot find module '@libsql/…'` means the native
binding did not ship (guarded by `outputFileTracingIncludes` in
`next.config.mjs` — if you see it, the tracing config regressed).

### Deployed site shows "Application error: a server-side exception has occurred"

On current code this no longer happens for configuration problems (they show the
screen above). If you still see a digest, open that deployment's Runtime Logs in
Vercel — the digest line names the failing route — and re-check the Environment
Variables checklist below.

## Local verification commands (must all pass)

```bash
npx tsc --noEmit
npm test            # 19 files / 292 tests
npm run e2e
npm run build
# Fresh-checkout proof (catches untracked files like src/lib/storage/*)
git archive HEAD | tar -x -C /tmp/fresh
cd /tmp/fresh && npm ci && npm run build
```
