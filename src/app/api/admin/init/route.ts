import { NextRequest } from 'next/server';
import { ensureSchema, isInitialized, seedSystemDefaults } from '@/lib/bootstrap';
import { checkBoot } from '@/lib/boot-check';
import { all } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/init
 *
 * Idempotent schema + seed for Vercel (no shell).
 *
 * - On first deploy, visit /setup in the browser — that page already calls
 *   isInitialized() which triggers ensureSchema(), so no manual step is needed.
 * - If you prefer a programmatic hook (e.g. after `vercel --prod`), POST here:
 *     curl -X POST https://your-app.vercel.app/api/admin/init \
 *          -H "Authorization: Bearer $ADMIN_INIT_SECRET"
 *
 * Set ADMIN_INIT_SECRET in Vercel env to protect this endpoint. When the
 * secret is set, the header is required. When it is not set, the endpoint
 * is only open while the system is still uninitialized (so the very first
 * caller can bootstrap without a secret, but afterwards it is locked).
 */
export async function POST(request: NextRequest) {
  // Fail as JSON (not a 500 HTML page) when the deployment is misconfigured.
  const boot = checkBoot();
  if (!boot.ok) {
    return Response.json(
      { ok: false, error: boot.title, hint: boot.intro, steps: boot.steps, detail: boot.detail ?? null },
      { status: 503 },
    );
  }

  const secret = process.env.ADMIN_INIT_SECRET?.trim();

  if (secret) {
    const header = request.headers.get('authorization') || request.headers.get('x-init-token') || '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (token !== secret) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
  } else {
    // No secret configured — only allow while uninitialized to prevent abuse
    if (boot.initialized) {
      return new Response(JSON.stringify({ ok: false, error: 'Already initialized — set ADMIN_INIT_SECRET to re-seed.' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  try {
    ensureSchema();
    seedSystemDefaults();

    const tables = all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((t) => t.name);

    const initialized = isInitialized();

    return Response.json({
      ok: true,
      message: initialized ? 'System is initialized.' : 'Schema and defaults seeded. Visit /setup to create the first Super Admin.',
      tables: tables.length,
      tableNames: tables,
      initialized,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export async function GET() {
  try {
    // Lightweight status without triggering seed
    const tables = (() => {
      try {
        return all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ).map((t) => t.name);
      } catch {
        return [];
      }
    })();
    return Response.json({
      ok: true,
      tables: tables.length,
      initialized: (() => {
        try {
          return isInitialized();
        } catch {
          return false;
        }
      })(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
