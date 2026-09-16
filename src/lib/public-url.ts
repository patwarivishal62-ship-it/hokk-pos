import 'server-only';
import { headers } from 'next/headers';
import { hostingPublicBaseUrl, requestOriginFromHeaders } from '@/lib/hosting';
import { getSetting } from '@/lib/settings';

/**
 * Returns the public base URL for the current request.
 *
 * An administrator-set database value is authoritative. Otherwise the host
 * that handled this request is used before provider environment metadata. This
 * makes image links work on Render, Vercel, custom domains and reverse proxies
 * without asking the operator to copy the deployment URL into Settings.
 */
export async function publicBaseUrlForRequest(): Promise<string> {
  const configured = getSetting('storage.public_base_url').trim();
  if (configured) return configured.replace(/\/+$/, '');

  try {
    const requestHeaders = await headers();
    return hostingPublicBaseUrl(requestOriginFromHeaders(requestHeaders));
  } catch {
    // Domain actions are also called directly by integration tests and scripts,
    // where Next has no request AsyncLocalStorage. Provider metadata remains a
    // valid no-request fallback in those contexts.
    return hostingPublicBaseUrl();
  }
}
