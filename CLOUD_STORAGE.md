# Shared online storage — Cloudinary (images) + Turso (product data)

## What "local storage" actually means here

When the app says images go to **local storage**, it means a plain folder on
the hard disk of **the computer running the app** (`storage/uploads` inside
this project). It is *not* the browser's localStorage, and when you run the
app on your laptop it effectively *is* your laptop's disk.

That is why device B cannot see what device A uploaded: the photo file only
exists on device A's disk. The same is true of everything else — products,
users, settings all live in a single SQLite file (`data/hokk.db` by default),
again on whichever machine runs the app.

Two separate gaps, two fixes:

| Gap | Fix (both free, no credit card) |
| --- | --- |
| Product **photos** trapped on one machine | **Cloudinary** — uploads go to one online account; every device views them instantly, and Shopify imports the same URLs |
| Product **data** (names, prices, users…) trapped in one file | **Turso** — the SQLite database lives online; every device/app copy reads and writes the same data |

This guide sets both up. The app already supports them — no code changes,
just accounts + environment variables.

---

## Part 1 — Cloudinary for images (5 minutes)

### 1. Create the free account

1. Go to **https://cloudinary.com** → **Sign up for free** (email + password,
   no credit card).
2. Open the **Dashboard** (left sidebar → Dashboard, or it lands there after
   signup). Near the top you will see three values:
   - **Cloud name** (e.g. `dxy123abc`)
   - **API Key** (a number)
   - **API Secret** (click the eye icon to reveal it)

Keep that tab open — you paste these into the app next.

### 2. Add the credentials to the app

**Running on your laptop** — create/edit `.env` in the project root:

```bash
CLOUDINARY_CLOUD_NAME="dxy123abc"
CLOUDINARY_API_KEY="123456789012345"
CLOUDINARY_API_SECRET="AbCdEfGhIjKlMnOpQrStUvWx"
STORAGE_BACKEND="CLOUDINARY"
```

**Deployed on Render** — Dashboard → your service → **Environment** → add the
same four variables (the Blueprint in `render.yaml` already declares them;
fill in the three `sync: false` values and set `STORAGE_BACKEND` to
`CLOUDINARY`), then redeploy.

**On Vercel** — Project → Settings → Environment Variables → add the four,
then redeploy.

### 3. Restart and verify

```bash
npm run dev
```

Then, as an admin:

1. Open **Settings → Storage**. You should see the badge
   **"Cloudinary connected (your-cloud-name)"**.
2. Click **Test connection**. It uploads a tiny image, reads it back over its
   public URL and deletes it. Success means uploads from this deployment are
   viewable online.
3. Make sure the **Storage backend** dropdown says **CLOUDINARY** and save
   (skip this if you set `STORAGE_BACKEND` in the environment — env wins).
4. Open any product → **Images** → upload a photo. It appears immediately —
   and the same photo is visible from any other device logged into the same
   database, because the file lives at a public
   `https://res.cloudinary.com/…` URL, not on your laptop.

### 4. Move existing photos online (one click)

Photos uploaded *before* the switch still sit on the old machine's disk. In
**Settings → Cloud storage tools** click **Move local images to cloud**. It
copies up to 100 photos per run to the same
`<prefix>/<original|final>/<SKU>/<file>` layout new uploads use — run it again
if you have more. Local files are kept as backup; only delete
`storage/uploads` after spot-checking the cloud copies.

Notes:

- Rows remember their own backend, so LOCAL and CLOUDINARY photos can coexist
  — old photos keep serving from disk until you migrate them.
- Promoting an image to **Final** after the switch automatically writes the
  Final copy to the cloud.
- Deleting with "also delete the stored file" removes the Cloudinary copy too.
- `GET /api/health` reports the active backend and whether Cloudinary is
  configured (never the secrets).

---

## Part 2 — Turso for shared product data (10 minutes)

Without this step, device A and device B each keep their **own** product list
even with Cloudinary on — because the database file is still per-machine.
Turso hosts that SQLite database online so every device shares one catalog.

### 1. Create the free database

Install the CLI once (macOS/Linux/WSL):

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup            # free account, GitHub login in the browser
turso db create hokk-pos     # location defaults sensibly; add --location bom for Mumbai
turso db show hokk-pos --url # → libsql://hokk-pos-<org>.turso.io
turso db tokens create hokk-pos
```

(`bom` = Mumbai keeps latency from India low. Run `turso db locations` to see
all regions.)

### 2. Point the app at it

In `.env` (every laptop, plus Render/Vercel env vars):

```bash
DATABASE_URL="libsql://hokk-pos-<org>.turso.io"
TURSO_AUTH_TOKEN="<the token from step 1>"
```

Then initialise and create the first admin:

```bash
npm run db:init      # applies db/schema.sql to the Turso database
npm run bootstrap    # seeds roles/settings + the SEED_ADMIN_* super admin
npm run dev
```

From now on, **every device with these two variables shares one catalog**:
add a product on device A, see it on device B. Combine with Cloudinary and
photos are shared too — device-independent teamwork with no deploy required.

### 3. Moving existing data (optional)

If you already built a catalog in a local file, copy it up once:

```bash
sqlite3 data/hokk.db .dump | turso db shell hokk-pos
```

Then verify counts (`turso db shell hokk-pos "select count(*) from product;"`)
before switching `DATABASE_URL` over.

### Alternative: deploy once on Render instead

If the whole team logs into **one deployed copy** of the app (e.g.
`hokk-pos.onrender.com` with its persistent disk), that deployment's disk +
database file are already shared — no Turso needed. See `RENDER.md`. Even
then, Cloudinary is still recommended for photos: disk files are tied to one
server and its backups, while cloud URLs survive redeploys and feed Shopify
directly.

---

## How Shopify export is affected

Shopify fetches `Product image URL` over plain HTTPS with no login, so only
**public** URLs work. Before, that meant your deployment's own
`/api/media/…` URLs; now Cloudinary URLs (`https://res.cloudinary.com/…`)
flow into the CSV automatically and import from anywhere. The export preview
still warns about any image without a public URL.

## Costs and limits (free tiers)

- **Cloudinary free**: ~25 credits/month (storage ≈ 25 GB, bandwidth pooled —
  far more than a product-photo catalog needs to start). No credit card to
  sign up. Usage is visible on their Dashboard → Account → Usage.
- **Turso free (Starter)**: 500 databases, generous row-read/write quotas —
  plenty for a catalog POS. No credit card to start.

Both bill only if you grow past the free tier; the app works identically on
paid plans (just keep the same variables). Check current pricing on their
sites — free tiers change.

## Troubleshooting

| Symptom | Cause → fix |
| --- | --- |
| Settings shows "Cloudinary not configured" | One of the three `CLOUDINARY_*` vars is missing/typo'd. They are read at runtime — save `.env` and **restart** `npm run dev`. |
| Saving backend CLOUDINARY is rejected | Same as above — the app refuses the switch until credentials exist so uploads can't break silently. |
| Backend dropdown is disabled | `STORAGE_BACKEND` is set in the environment, which overrides Settings. Unset it to control the backend from the UI. |
| Upload fails with "Invalid Signature" | `CLOUDINARY_API_SECRET` has whitespace or a wrong value. Re-copy from the Dashboard (eye icon) with no extra spaces. |
| Migrated photo shows broken on device B | The migration ran on device A but its DB row points at a local file device A no longer has — re-upload that photo, or run the migration on the machine holding the files. |
| Product added on A missing on B | The two devices use different databases. Both need the same Turso `DATABASE_URL` + token (or both log into one Render deployment). |
| `/api/media/…` link 404s after migrating | Old LOCAL links keep working from disk; once a row migrates, the POS uses the cloud URL automatically. A stale copied link to a deleted local file will 404 — copy the fresh URL from the product page. |
