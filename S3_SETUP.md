# S3-compatible storage setup (Cloudflare R2 recommended)

Google Drive requires an OAuth dance (`drive:authorize`, refresh tokens that
expire or get invalidated, `unauthorized_client` errors) and its
`lh3.googleusercontent.com` links are unreliable for automated fetchers. The
S3-compatible backend replaces all of that with **static access keys** —
nothing expires, nothing needs re-consent, and image URLs are stable.

The adapter speaks the standard S3 REST API with AWS Signature Version 4
(hand-rolled with `node:crypto` in `src/lib/storage/s3.ts` — no AWS SDK
dependency), so it works with:

| Provider | Free tier | Egress fees | Notes |
| --- | --- | --- | --- |
| **Cloudflare R2** (recommended) | 10 GB storage, 1 M writes/10 M reads per month | **none** | Static keys, `region = auto`, public bucket URL or custom domain |
| Backblaze B2 | 10 GB storage | none via Cloudflare Bandwidth Alliance | Endpoint `https://s3.<region>.backblazeb2.com` |
| AWS S3 | 5 GB (12 months) | per GB | No custom endpoint needed |
| MinIO (self-hosted) | — | — | Endpoint `http://your-server:9000` |

## Why R2 is the recommended replacement

- **No OAuth.** You create one API token, paste two values into `.env`, done.
  No consent screens, no refresh tokens, no `drive:doctor`.
- **Zero egress fees.** Shopify fetches every image during CSV import; with
  AWS S3 you pay for those bytes, with R2 you do not.
- **Permanent public URLs.** `https://pub-<hash>.r2.dev/<key>` (or your own
  domain on Cloudflare) — Shopify can re-import an old CSV any time.
- **10 GB free** ≈ 2 000–5 000 product photos at the sizes the catalog enforces.

## Cloudflare R2, step by step

### 1. Create the bucket

1. Sign up / log in at <https://dash.cloudflare.com> (a free plan is enough).
2. Left sidebar → **R2 Object Storage** → **Create bucket**.
3. Name it e.g. `hokk-product-images`. Location: *Automatic*. Create.

### 2. Create the API credentials

1. In the R2 overview, click **Manage R2 API Tokens** (top right) → **Create API Token**.
2. Permissions: **Object Read & Write**. Scope: *Apply to specific buckets
   only* → select your bucket.
3. Create. You get three values — copy them now (the secret is shown once):

   | Value | Goes into |
   | --- | --- |
   | Access Key ID | `S3_ACCESS_KEY_ID` |
   | Secret Access Key | `S3_SECRET_ACCESS_KEY` |
   | Endpoint (`https://<account_id>.r2.cloudflarestorage.com`) | `S3_ENDPOINT` |

### 3. Enable public access (for permanent Shopify URLs)

1. Bucket → **Settings** → **Public access** → **R2.dev subdomain** → *Allow access*.
2. The `https://pub-<hash>.r2.dev` URL is your `S3_PUBLIC_BASE_URL`.
   (For production, a custom domain on a Cloudflare zone is the nicer option —
   same field.)

### 4. Configure the app

In `.env` (or Vercel project settings):

```env
STORAGE_BACKEND="S3"
S3_ACCESS_KEY_ID="<access key id>"
S3_SECRET_ACCESS_KEY="<secret access key>"
S3_BUCKET="hokk-product-images"
S3_REGION="auto"
S3_ENDPOINT="https://<account_id>.r2.cloudflarestorage.com"
S3_PUBLIC_BASE_URL="https://pub-<hash>.r2.dev"
```

Restart the dev server / redeploy.

### 5. Verify

```bash
npm run s3:verify
```

This HEADs the bucket, uploads a probe image to `original/VERIFY/` and
`final/VERIFY/`, reads the bytes back, fetches the public URL anonymously,
and deletes the probes. Then in the app: **Settings → Storage → “Test
S3-compatible connection”** — on success the backend switches to S3 and the
non-secret settings are saved.

## How images reach Shopify

The Shopify CSV export writes `Image Src` from each image's public URL:

- **`S3_PUBLIC_BASE_URL` set** → permanent links (`…/original/<SKU>/<file>.jpg`).
  Re-import the CSV whenever you like.
- **`S3_PUBLIC_BASE_URL` empty** → each export mints presigned links valid for
  `S3_PRESIGN_EXPIRES` seconds (default 7 days, the S3 maximum). Shopify only
  needs the URL to work at import time, so this is fine for a private bucket —
  just import the CSV within the window.

Uploads keep the same two-folder layout the Drive backend used:
`original/<SKU>/<file>` (raw) and `final/<SKU>/<file>` (approved). Promoting
an image Original → Final copies the object across prefixes.

## Other providers

- **Backblaze B2**: bucket → *App Keys* → create a key with
  *Read & Write*. `S3_ENDPOINT=https://s3.<region>.backblazeb2.com` (e.g.
  `s3.us-west-004.backblazeb2.com`), `S3_REGION` = the region from the
  endpoint. Public files need *Bucket Files: Public* or a CDN in front.
- **AWS S3**: leave `S3_ENDPOINT` empty and set `S3_REGION` (e.g.
  `ap-south-1` for Mumbai). The adapter then uses
  `https://<bucket>.s3.<region>.amazonaws.com`. Public URLs require a bucket
  policy / CloudFront; otherwise use presigned mode.
- **MinIO**: `S3_ENDPOINT=http://your-server:9000`, any `S3_REGION`.

## Migrating from Google Drive

Existing Drive-hosted images keep working: every `product_image` row stores
its own `storage_backend`, and URL resolution is per row. New uploads go to
S3 the moment the backend is switched. To move old images, download them from
Drive and re-upload via the product page (the checksum duplicate guard will
skip identical files), or copy them into the bucket under the same
`original/<SKU>/<file>` keys and update the rows' `storage_backend` to `S3`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `SignatureDoesNotMatch` | `S3_SECRET_ACCESS_KEY` is wrong or has trailing whitespace |
| `InvalidAccessKeyId` | `S3_ACCESS_KEY_ID` is wrong, or the token was deleted |
| `NoSuchBucket` | `S3_BUCKET` typo, or token scoped to a different bucket |
| `AuthorizationHeaderMalformed` … region | Set `S3_REGION` to the region named in the error |
| Public URL 404s | Public access not enabled for the bucket, or `S3_PUBLIC_BASE_URL` points at the wrong bucket |
| Export says images have no public URL | No public base URL **and** credentials missing — presigning is impossible |
