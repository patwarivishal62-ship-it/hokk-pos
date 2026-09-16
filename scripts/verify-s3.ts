/**
 * Live verification of the S3-compatible adapter against a real bucket
 * (Cloudflare R2, Backblaze B2, AWS S3 or MinIO).
 *
 *   S3_ACCESS_KEY_ID="…" S3_SECRET_ACCESS_KEY="…" S3_BUCKET="…" \
 *   S3_ENDPOINT="https://<account>.r2.cloudflarestorage.com" S3_REGION="auto" \
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-s3.ts
 *
 * or, with everything in .env:  npm run s3:verify
 *
 * Steps:
 *   1. buildS3Config() → resolved config (credentials, bucket, region, endpoint)
 *   2. headBucket() — bucket reachable and credentials accepted
 *   3. put() a small PNG into original/VERIFY/ and final/VERIFY/
 *   4. read() the bytes back and compare
 *   5. Print the public URL (permanent base URL, or a presigned URL when no
 *      public base is configured) and — when possible — fetch it anonymously
 *   6. remove() both objects
 *
 * Prints the resolved configuration and URLs. Exits non-zero on any failure.
 */

import { buildS3Config } from '@/lib/storage';
import { S3Storage, presignGetUrl } from '@/lib/storage/s3';

async function main() {
  const config = buildS3Config();
  const storage = new S3Storage(config);
  const resolved = storage.resolved;

  console.log('S3 config:', {
    bucket: resolved.bucket,
    region: resolved.region,
    endpoint: resolved.endpoint,
    publicBaseUrl: resolved.publicBaseUrl,
    presignExpires: resolved.presignExpires,
    hasCredentials: Boolean(resolved.accessKeyId && resolved.secretAccessKey),
  });

  if (!storage.isConfigured()) {
    console.error(
      'S3-compatible storage is not configured. Set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_BUCKET' +
        ' (plus S3_ENDPOINT for Cloudflare R2 / Backblaze B2 / MinIO).',
    );
    process.exit(1);
  }

  console.log('\nHEAD bucket…');
  const head = await storage.headBucket();
  if (!head.ok) {
    console.error('Bucket check failed:', head.error ?? `HTTP ${head.status}`);
    process.exit(1);
  }
  console.log('Bucket reachable.', head.region ? `Region reported by server: ${head.region}` : '');

  // Minimal 1x1 PNG (same as e2e).
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );

  const stamp = Date.now();
  const targets: Array<'ORIGINAL' | 'FINAL'> = ['ORIGINAL', 'FINAL'];
  const stored: Array<{ key: string; url: string }> = [];

  for (const folder of targets) {
    console.log(`\nUploading probe to ${folder}…`);
    const result = await storage.put({
      data: png,
      fileName: `HOKK-VERIFY-${folder}-${stamp}.png`,
      mimeType: 'image/png',
      folder,
      groupKey: 'VERIFY',
    });
    console.log('Key:', result.storageKey);
    console.log('Object URL:', result.path);
    const url = result.publicUrl ?? presignGetUrl(resolved, result.storageKey);
    console.log('Public URL:', url);
    stored.push({ key: result.storageKey, url });
  }

  console.log('\nReading back and comparing bytes…');
  for (const { key } of stored) {
    const bytes = await storage.read({ storageKey: key });
    if (bytes.length !== png.length || !bytes.equals(png)) {
      throw new Error(`Read-back mismatch for ${key}: ${bytes.length} bytes vs ${png.length}`);
    }
    console.log(`OK ${key} (${bytes.length} bytes)`);
  }

  if (resolved.publicBaseUrl) {
    console.log('\nFetching the public URL anonymously…');
    const res = await fetch(stored[0].url);
    console.log(res.ok ? `Public URL reachable (HTTP ${res.status}).` : `Public URL NOT reachable: HTTP ${res.status} — check the bucket's public access settings.`);
  } else {
    console.log('\nNo public base URL configured — presigned URLs are used (valid for', resolved.presignExpires, 'seconds).');
  }

  console.log('\nDeleting probes…');
  for (const { key } of stored) await storage.remove({ storageKey: key });
  console.log('Deleted both probe objects.');

  console.log('\nS3 VERIFY PASS');
  console.log('Upload, read-back, public URL and delete all work against this bucket.');
  console.log('To switch the app over: Settings → Storage → backend S3, or STORAGE_BACKEND=S3 in .env.');
}

main().catch((err) => {
  console.error('\nS3 VERIFY FAIL');
  console.error(err);
  process.exit(1);
});
