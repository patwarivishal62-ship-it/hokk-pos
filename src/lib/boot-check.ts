import 'server-only';
import { isInitialized } from '@/lib/bootstrap';
import { dbAuthToken, resolveDbUrl } from '@/lib/db';

/**
 * Deployment pre-flight check.
 *
 * Without it, a misconfigured deployment (e.g. no DATABASE_URL on Vercel)
 * dies deep inside a Server Component and the visitor only sees Next.js's
 * cryptic "Application error: a server-side exception has occurred" digest
 * screen. Instead, the root layout renders a friendly screen that names the
 * missing piece and lists the exact steps to fix it. Pure function of env +
 * a DB probe; safe to call on every page render.
 */

export interface BootOk {
  ok: true;
  initialized: boolean;
}

export interface BootFailure {
  ok: false;
  /** Short headline, e.g. "Database is not configured". */
  title: string;
  /** One plain-language sentence explaining why the app cannot start. */
  intro: string;
  /**
   * Ordered fix steps. Backtick spans are rendered as inline code by
   * <BootErrorScreen/>, so wrap env names / values / paths in backticks.
   */
  steps: string[];
  /** Raw technical error, shown collapsed. Never contains secrets. */
  detail?: string;
}

export type BootStatus = BootOk | BootFailure;

function isRemoteDbUrl(raw: string): boolean {
  return (
    raw.startsWith('libsql://') ||
    raw.startsWith('https://') ||
    raw.startsWith('http://') ||
    raw.startsWith('wss://') ||
    raw.startsWith('ws://')
  );
}



function sessionSecretFailure(onVercel: boolean): BootFailure {
  return {
    ok: false,
    title: 'Sign-in secret (`SESSION_SECRET`) is missing',
    intro: 'The app cannot sign users in without a session secret, so it stopped before loading.',
    steps: onVercel
      ? [
          'In Vercel, open this project → `Settings` → `Environment Variables`.',
          'Add `SESSION_SECRET` with any random value of 32 or more characters (scope: `Production`).',
          'Go to `Deployments` → `⋯` → `Redeploy` so the new variable takes effect, then reload this page.',
        ]
      : [
          'Copy `.env.example` to `.env` if you have not already.',
          'Set `SESSION_SECRET` in `.env` to any random value of 32 or more characters.',
          'Restart the dev server and reload this page.',
        ],
  };
}

function vercelDbFailure(): BootFailure {
  return {
    ok: false,
    title: 'Database is not connected',
    intro:
      'This deployment has no database. On Vercel the app cannot use a local file — the database lives on Turso ' +
      '(free tier is enough) and connecting it takes about five minutes.',
    steps: [
      'Create a free database at `turso.tech` → `Databases` → `Create Database` (name it `hokk-prod`) and copy its URL — it looks like `libsql://hokk-prod-….turso.io`.',
      'In Turso, open the database → create an API token and copy it.',
      'In Vercel, open this project → `Settings` → `Environment Variables` (scope: `Production`) and add: `DATABASE_URL` = the `libsql://…` URL, `TURSO_AUTH_TOKEN` = the token, `SESSION_SECRET` = any random 32+ characters, `ALLOWED_ORIGINS` = this site’s domain (e.g. `hokk-pos.vercel.app`).',
      'Go to `Deployments` → `⋯` → `Redeploy`, then open `/setup` on your site and create the first Super Admin account.',
    ],
  };
}

function tokenFailure(onVercel: boolean): BootFailure {
  return {
    ok: false,
    title: 'Database password (`TURSO_AUTH_TOKEN`) is missing',
    intro: 'A remote database URL is set, but the token needed to connect to it is missing.',
    steps: onVercel
      ? [
          'In Turso, open your database → create an API token and copy it.',
          'In Vercel, open this project → `Settings` → `Environment Variables` and add `TURSO_AUTH_TOKEN` (scope: `Production`).',
          'Go to `Deployments` → `⋯` → `Redeploy`, then reload this page.',
        ]
      : [
          'Set `TURSO_AUTH_TOKEN` in your `.env` next to `DATABASE_URL`.',
          'Restart the dev server and reload this page.',
        ],
  };
}

function connectionFailure(detail: string, onVercel: boolean): BootFailure {
  return {
    ok: false,
    title: 'Could not connect to the database',
    intro: 'The database settings are present but the connection itself failed. Usually a typo in the URL or an expired token.',
    steps: onVercel
      ? [
          'In Vercel → `Settings` → `Environment Variables`, check that `DATABASE_URL` starts with `libsql://` (no quotes or spaces around it) and `TURSO_AUTH_TOKEN` is current.',
          'The token must be a full-access database token — create a fresh one with `turso db tokens create hokk-prod` (or in the Turso dashboard under the database, not under platform API tokens) and update the variable. Platform API tokens and read-only tokens cannot connect.',
          'Go to `Deployments` → `⋯` → `Redeploy`, then reload this page.',
        ]
      : ['Check `DATABASE_URL` in your `.env` (local development uses `file:./dev.db`).', 'Restart the dev server and reload this page.'],
    detail,
  };
}

export function checkBoot(): BootStatus {
  // Never probe during `next build` (page prerender): there is no database at
  // build time and the check re-runs on every real request anyway.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return { ok: true, initialized: true };
  }

  const onVercel = process.env.VERCEL === '1';
  // Normalized (trimmed, unquoted) — same value the db layer connects with.
  const dbUrl = resolveDbUrl();

  // 1. Sign-in is impossible without this (src/lib/session.ts throws) — and on
  // a fresh Vercel deploy it is the most commonly forgotten variable.
  if ((process.env.SESSION_SECRET || '').length < 16) {
    return sessionSecretFailure(onVercel);
  }

  // 2. Vercel's filesystem is read-only: a `file:` URL (or no URL at all, which
  // defaults to one) can never work there. Fail with guidance, not a digest.
  if (onVercel && !isRemoteDbUrl(dbUrl)) {
    return vercelDbFailure();
  }

  // 3. Remote URL without any accepted auth token.
  if (dbUrl && isRemoteDbUrl(dbUrl) && !dbAuthToken()) {
    return tokenFailure(onVercel);
  }

  // 4. Probe the database. On first run this also creates the schema
  // (ensureSchema inside isInitialized) — same behaviour as before.
  try {
    return { ok: true, initialized: isInitialized() };
  } catch (error) {
    return connectionFailure(error instanceof Error ? error.message : String(error), onVercel);
  }
}
