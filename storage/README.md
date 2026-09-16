# Storage Layout

This directory is ignored by git (`/storage/` in .gitignore) except for `.gitkeep` and this README.

Uploads are stored on local disk:

```
storage/
├─ uploads/
│  ├─ original/<SKU>/HOKK-...-HERO.jpg   ← raw uploads
│  └─ final/<SKU>/HOKK-...-HERO.jpg      ← approved, Shopify-ready
└─ exports/                               ← generated CSV/Excel (optional)
```

- Files are served at `/api/media/<key>` (unauthenticated, so Shopify can fetch)
- Public URLs are generated from the current request host automatically
- `PUBLIC_BASE_URL` is an optional override for a dedicated/custom image domain
- If neither a request host nor hosting metadata is available, Shopify CSVs leave image URLs blank and warn
- On Render, `UPLOAD_DIR` is `/var/data/storage/uploads` on the persistent disk,
  so images survive deploys and restarts
