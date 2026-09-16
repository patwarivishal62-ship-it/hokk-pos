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
- Requires `PUBLIC_BASE_URL` to generate public URLs, e.g. `http://localhost:3000`
  (on Render this defaults to the service's own URL automatically)
- Without a public base URL, the Shopify CSV will have blank image URLs and warn
- On Render, `UPLOAD_DIR` is `/var/data/storage/uploads` on the persistent disk,
  so images survive deploys and restarts
