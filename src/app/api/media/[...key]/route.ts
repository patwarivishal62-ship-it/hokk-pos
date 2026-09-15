import { notFound } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { resolveLocalImage } from '@/lib/media-server';

export const dynamic = 'force-dynamic';

/**
 * Serves uploaded assets stored on local disk.
 *
 * NOTE: this endpoint is deliberately unauthenticated. Shopify's CSV importer
 * fetches Image Src over plain HTTPS with no credentials, so anything served
 * here is publicly reachable by design. Set PUBLIC_BASE_URL to this route's
 * origin only when that is acceptable; otherwise use the Google Drive backend.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params;
  if (!key?.length) notFound();
  const joined = decodeURIComponent(key.join('/'));
  if (joined.includes('..')) notFound();

  const resolved = resolveLocalImage(joined);
  if (!resolved) notFound();

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
    notFound();
  }
}
