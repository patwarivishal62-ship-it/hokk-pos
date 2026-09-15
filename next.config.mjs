/**
 * Origins permitted to drive this app from a different host than the one Next
 * binds to.
 *
 * Two separate Next.js checks need this when the app sits behind a proxy:
 *
 *  1. Server Action CSRF gate — Next compares the request's `Origin` against
 *     `x-forwarded-host`/`host` and aborts with "Invalid Server Actions
 *     request." (HTTP 500) on a mismatch. Every form in this app is a Server
 *     Action, so a mismatch would break login itself, not just uploads.
 *  2. Dev asset guard — cross-origin requests to `/_next/*` are warned about
 *     now and blocked in a future major version unless allowlisted via
 *     `allowedDevOrigins`.
 *
 * Configure with ALLOWED_ORIGINS (comma-separated bare hosts or `*.domain`
 * patterns, no protocol). Defaults to the Arena preview domain so the app works
 * behind the sandbox proxy out of the box; set it to your real domain in
 * production.
 */
const DEFAULT_ALLOWED_ORIGINS = ['*.e2b.app'];

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''))
  .filter(Boolean);

const effectiveAllowedOrigins = allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native bindings (libsql) must stay external to the server bundle
  serverExternalPackages: ['libsql'],
  // Dev-time cross-origin asset requests (see note 2 above).
  allowedDevOrigins: effectiveAllowedOrigins,
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
      // Server Action CSRF allowlist (see note 1 above).
      allowedOrigins: effectiveAllowedOrigins,
    },
  },
  // Uploads are streamed from app-managed storage; keep the proxy permissive.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
