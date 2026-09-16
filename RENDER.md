# Deploying on Render (images on a persistent disk)

Render hosts the app as a normal Node web service with a **persistent disk**
mounted at `/var/data`. Product photographs, the SQLite database and generated
Shopify CSV/Excel exports all live on that disk, so they survive deploys,
restarts and instance replacements.

The repository ships the wiring: **`render.yaml`** (the Blueprint) plus
host-aware defaults in `src/lib/hosting.ts`. Deploying is three clicks and one
prompt.

> **Why the disk is not optional.** Render's filesystem outside a mounted disk is
> *ephemeral* — every deploy and restart starts from a clean image. Without a
> disk, uploads vanish and the catalog resets. That is silent and unrecoverable,
> so the app now refuses to boot on Render when nothing is mounted at the disk
> path, and shows a screen with the fix (the same pattern as the Vercel
> "database is not connected" screen). `ALLOW_EPHEMERAL_STORAGE=1` is the
> deliberate opt-out.

---

## 1. Deploy the Blueprint

1. Push this repository to GitHub (`main` branch).
2. Render Dashboard → **New** → **Blueprint** → select the repo → **Apply**.
   Render reads `render.yaml` and shows exactly what it will create:
   a web service `hokk-pos` and a 10 GB disk `hokk-data` mounted at `/var/data`.
3. Render prompts for the two `sync: false` values:

   | Variable | What to enter |
   | --- | --- |
   | `ALLOWED_ORIGINS` | The service's own host, e.g. `hokk-pos.onrender.com` (or a custom domain). **Required** — without it Next.js rejects every form submission behind Render's proxy (`Invalid Server Actions request.`), which breaks login. |
   | `PUBLIC_BASE_URL` | Optional custom-domain override. Leave blank to use the host of the current HTTPS request automatically. |

   `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are optional — see step 3.
4. **Create** and wait for the build (`npm ci && npm run build`).
5. Open the service URL. It should load the login page (no products yet).

`plan: 0.5c-512mb` is the cheapest instance type that supports a disk. Bump it
in the dashboard (Compute → Instance Type) if the catalog grows; the region
(`singapore`, closest to India) cannot be changed after creation.

## 2. What the Blueprint configures

```yaml
disk:
  name: hokk-data
  mountPath: /var/data
  sizeGB: 10
envVars:
  - key: DATABASE_URL      value: file:/var/data/hokk.db
  - key: UPLOAD_DIR        value: /var/data/storage/uploads
  - key: EXPORT_DIR        value: /var/data/storage/exports
  - key: SESSION_SECRET    generateValue: true     # random 256-bit value
  - key: ALLOWED_ORIGINS   sync: false
```

You do **not** have to set these: even with an empty environment the code
detects Render (`RENDER` / `RENDER_SERVICE_ID` / `RENDER_EXTERNAL_HOSTNAME`) and
defaults to `<disk>/storage/uploads`, `<disk>/storage/exports` and
`file:<disk>/hokk.db`. Image URLs use the forwarded host of the current request,
with `RENDER_EXTERNAL_HOSTNAME` as a fallback. The
Blueprint sets them explicitly so the intent is visible in the dashboard.

Resulting layout on the disk:

```
/var/data/
├── hokk.db                     SQLite catalog (WAL: hokk.db-wal, hokk.db-shm)
└── storage/
    ├── uploads/
    │   ├── original/<SKU>/HOKK-SAR-ZK-001-HERO.jpg   raw photographs
    │   └── final/<SKU>/HOKK-SAR-ZK-001-HERO.jpg      approved, export-ready
    └── exports/                                      Shopify CSV + Excel history
```

## 3. First run

The schema is created on the first request, then either:

- **UI**: open `/setup` and create the first Super Admin — the quickest route; or
- **Shell**: Render Dashboard → service → **Shell** (runs inside the instance,
  with the disk attached) and run

  ```bash
  npm run bootstrap     # roles, settings, slot templates + first Super Admin
  ```

Do **not** put `npm run db:init` / `bootstrap` in `preDeployCommand`: pre-deploy
runs on separate compute *without* the disk, so it would migrate the wrong
empty filesystem.

## 4. Shopify image URLs

Shopify downloads every `Product image URL` with no credentials, so the app
serves uploads publicly at `/api/media/<key>` and publishes:

```
https://<service>.onrender.com/api/media/final/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.jpg
```

- This URL is derived automatically from the current request's
  `x-forwarded-host` / `host`; `RENDER_EXTERNAL_HOSTNAME` is the no-request fallback.
- Set `PUBLIC_BASE_URL` (Settings → Storage, or the env var) only to force a
  separate **custom domain** — e.g. `https://images.houseofkalakatha.com`; that
  explicit value wins over the request host.
- Custom domain at Render → service → **Settings** → **Custom Domains**, then
  update `ALLOWED_ORIGINS` to the new host as well.

Image URLs embedded in an **old** CSV keep working as long as the service exists
— they point at the same `/api/media/<key>` path.

## 5. Verify the deployment

```bash
npm run render:verify        # from Render Shell, or any machine
```

Checks, in order:

1. **Disk** — a filesystem is actually mounted at the mount path (it compares
   filesystem device ids; `/var/data` existing is not enough).
2. **Locations** — upload dir, export dir and database all sit *inside* the
   disk, and are writable.
3. **Round trip** — writes a probe PNG through the storage adapter, reads it
   back byte-for-byte, confirms it is on disk, deletes it.
4. **Public URL** — fetches `<base>/api/media/<key>` anonymously, exactly as
   Shopify would, and reports the HTTP status.

`GET /api/health` (the Blueprint's health-check path) reports the same facts as
JSON — host, storage backend, upload directory, database kind, whether the disk
is attached, and the public base URL. It returns **503** when the boot check
fails, so a misconfigured deploy is never routed traffic:

```bash
curl -s https://hokk-pos.onrender.com/api/health | jq
```

## 6. Backups

- **Disk snapshots** — Render snapshots the disk every 24 hours and keeps them
  for at least 7 days (service → **Disks** → snapshots). Restores are
  all-or-nothing and replace the disk, so use them for disaster recovery only.
- **Off-box copy** — the catalog is one SQLite file plus the uploads directory:

  ```bash
  # From a machine with SSH access to the service
  scp -s YOUR_SERVICE@ssh.singapore.render.com:/var/data/hokk.db ./hokk-$(date +%F).db
  scp -rs YOUR_SERVICE@ssh.singapore.render.com:/var/data/storage/uploads ./uploads-backup
  ```

  (Enable SSH in the service's settings first.) A weekly copy of both is enough
  for this catalog; `hokk.db` restores with `sqlite3` or by copying it back.

## 7. Operating notes

| Topic | What to know |
| --- | --- |
| **Scaling** | A disk pins the service to **one instance** and disables zero-downtime deploys — every deploy stops the old instance and starts the new one (a few seconds). Fine for a single team. |
| **Storage growth** | 10 GB ≈ 5 000 photographs at the enforced sizes. Disk size can be increased at any time (never decreased). |
| **Going bigger** | Disk size can be increased at any time (never decreased). 10 GB ≈ 5 000 photographs at the enforced sizes. |
| **Port** | `npm start` binds to `$PORT` (Render's default is 10000); locally it stays on 3000. |
| **Logs** | Dashboard → service → **Logs**. The boot check, storage adapter and export all log their failure reasons with the variable to fix. |
| **Free plan** | Render's free instances do not support disks, and they sleep. Use `0.5c-512mb` or larger. |
