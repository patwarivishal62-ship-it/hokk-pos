# Storage Layout

This directory is ignored by git (`/storage/` in .gitignore) except for `.gitkeep` and this README.

## LOCAL backend (`STORAGE_BACKEND=LOCAL`)

When running locally without Google Drive:

```
storage/
├─ uploads/
│  ├─ original/<SKU>/HOKK-...-HERO.jpg   ← raw uploads
│  └─ final/<SKU>/HOKK-...-HERO.jpg      ← approved, Shopify-ready
└─ exports/                               ← generated CSV/Excel (optional)
```

- Files are served at `/api/media/<key>` (unauthenticated, so Shopify can fetch)
- Requires `PUBLIC_BASE_URL` to generate public URLs, e.g. `http://localhost:3000` or your Vercel URL
- Without PUBLIC_BASE_URL, Shopify CSV will have blank image URLs and warn

## GDRIVE backend (`STORAGE_BACKEND=GDRIVE`)

Your Drive folder: https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH

Structure created automatically via `ensureFolders()` / `ensureFullStructure()`:

```
1iViabmuDwg8uboyWNmetl4cxoW4LsPuH/  (parent — your shared folder)
└─ House of Kala Katha/
   ├─ Original/   (raw)
   ├─ Final/      (Shopify-ready, publicly shared)
   ├─ Exports/    (CSV/Excel history)
   ├─ Imports/    (bulk import sheets)
   ├─ Archive/    (old assets)
   └─ Temp/       (staging)
```

- Each file uploaded is shared as "Anyone with the link — Reader"
- Public URL = `https://lh3.googleusercontent.com/d/{fileId}`
- `GDRIVE_PARENT_FOLDER_ID=1iViabmuDwg8uboyWNmetl4cxoW4LsPuH` (your folder)

See `/DRIVE_SETUP.md` for full setup instructions and verification steps.

## Setup script

```bash
npx tsx --tsconfig scripts/tsconfig.json scripts/setup-drive-structure.ts
# With credentials:
GDRIVE_SERVICE_ACCOUNT_JSON="$(cat service.json)" \
GDRIVE_PARENT_FOLDER_ID="1iViabmuDwg8uboyWNmetl4cxoW4LsPuH" \
npx tsx --tsconfig scripts/tsconfig.json scripts/setup-drive-structure.ts
```
