import { checkBoot } from '@/lib/boot-check';
import { dbAuthToken, resolveDbUrl } from '@/lib/db';
import { diskStatus, hostingPublicBaseUrl, isRender, renderExternalUrl } from '@/lib/hosting';
import { buildLocalConfig, getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Deployment health probe — used by `render.yaml` (`healthCheckPath`) and handy
 * when a Shopify import produces blank image URLs.
 *
 * Public and deliberately free of secrets: it reports *whether* things are
 * configured and which filesystem the uploads land on, never credentials or
 * database passwords. Returns 200 when
 * the app can serve, 503 when the pre-flight check fails (missing database,
 * missing Render disk, missing session secret) so a bad deploy is never routed
 * traffic.
 */
export async function GET() {
  const boot = checkBoot();
  const storage = getStorage();
  const disk = diskStatus();
  const dbUrl = resolveDbUrl();

  const payload = {
    status: boot.ok ? 'ok' : 'error',
    app: 'hokk-pos',
    host: isRender() ? 'render' : process.env.VERCEL ? 'vercel' : 'local',
    // Render's own URL (or PUBLIC_BASE_URL when a custom domain is set) — this
    // is what a Shopify CSV import fetches images from.
    publicBaseUrl: hostingPublicBaseUrl(),
    storage: {
      backend: 'LOCAL' as const,
      configured: storage.isConfigured(),
      localUploadDir: buildLocalConfig().uploadDir,
    },
    database: {
      kind: /^(libsql|https?|wss?):/i.test(dbUrl) ? 'remote' : 'file',
      // `file:/var/data/hokk.db` is tunable via DATABASE_URL.
      name: dbUrl.replace(/^file:/, '').split('/').pop() ?? null,
      tokenSet: Boolean(dbAuthToken()),
    },
    disk: {
      mountPath: disk.mountPath,
      attached: disk.persistent,
      required: disk.required,
      serviceUrl: renderExternalUrl() || null,
    },
    ...(boot.ok ? { initialized: boot.initialized } : { bootError: boot.title, bootHint: boot.steps[0] }),
  };

  return Response.json(payload, {
    status: boot.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
