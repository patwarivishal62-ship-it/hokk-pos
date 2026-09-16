import { notFound } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { resolveLocalImage } from '@/lib/media-server';
import { cloudinaryConfig, cloudinaryDeliveryUrl, isCloudPublicId } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Serves uploaded assets stored on local disk, and redirects cloud-hosted
 * assets to the CDN delivery URL (so links keep working after migrating
 * LOCAL rows to Cloudinary without proxying bytes through this server).
 *
 * NOTE: this endpoint is deliberately unauthenticated. Shopify's CSV importer
 * fetches Product image URL over plain HTTPS with no credentials, so anything
 * served here is publicly reachable by design (on Render the disk-backed
 * originals are served straight from the service's own URL).
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  if (!key?.length) notFound();
  const joined = decodeURIComponent(key.join('/'));
  if (joined.includes('..')) notFound();

  // Cloud public ids (e.g. hokk-pos/original/<SKU>/<file>) redirect straight
  // to the CDN instead of being read through this server.
  const cloud = cloudinaryConfig();
  if (cloud.cloudName && isCloudPublicId(joined, cloud.folderPrefix)) {
    return Response.redirect(cloudinaryDeliveryUrl(cloud.cloudName, joined), 302);
  }

  const resolved = resolveLocalImage(joined);
  if (resolved) {
    try {
      const buffer = await resolved.buffer;
      return new Response(new Uint8Array(buffer), {
        headers: {
          'content-type': resolved.mimeType,
          'content-length': String(buffer.length),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      // Fall through: with a custom CLOUDINARY_FOLDER the key may still be a
      // cloud public id that missed the prefix check above.
    }
  }

  if (cloud.cloudName) {
    return Response.redirect(cloudinaryDeliveryUrl(cloud.cloudName, joined), 302);
  }
  notFound();
}
