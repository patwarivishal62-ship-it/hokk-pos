/**
 * Session handling: random opaque token in an httpOnly cookie, signed with
 * HMAC so tampering is detectable without a DB round-trip, plus a DB row so
 * sessions can be revoked server-side.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { get, run } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { parsePermissions } from '@/lib/rbac';
import type { UserRow } from '@/lib/types';

export const SESSION_COOKIE = 'hokk_session';
export const SESSION_TTL_DAYS = 14;

/**
 * Cookie format: `<sessionId>.<randomToken>.<hmac(sessionId + "." + token)>`.
 *
 * The third segment is a signature over the first two, so a tampered cookie is
 * detectable without a database round-trip. The token itself stays a random
 * opaque value — it must never be derivable from the session id, otherwise
 * revoking a session row would be the only thing standing between an attacker
 * and an account.
 */
export function serializeSessionCookie(sessionId: string, token: string): string {
  return `${sessionId}.${token}.${sign(`${sessionId}.${token}`)}`;
}

export interface ParsedSessionCookie {
  sessionId: string;
  token: string;
  signatureValid: boolean;
}

/** Parses a cookie without touching the database; `signatureValid` is false for tampering. */
export function parseSessionCookie(raw: string): ParsedSessionCookie | null {
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [sessionId, token, signature] = parts;
  if (!sessionId || !token || !signature) return null;
  return { sessionId, token, signatureValid: safeEqual(signature, sign(`${sessionId}.${token}`)) };
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error('SESSION_SECRET must be set to at least 16 characters.');
  }
  return value;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const USER_WITH_SESSION_SELECT = `
  SELECT u.*, r.name AS role_name, r.permissions AS role_permissions,
         s.token AS session_token, s.expires_at AS expires_at
  FROM "user" u
  JOIN role r ON r.key = u.role_key
  JOIN session s ON s.user_id = u.id
  WHERE s.id = ?
`;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roleKey: string;
  roleName: string;
  jobTitle: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  permissions: string[];
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roleKey: row.role_key,
    roleName: row.role_name ?? row.role_key,
    jobTitle: row.job_title,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    permissions: parsePermissions(row.role_permissions),
  };
}

export async function createSession(userId: string, meta?: { userAgent?: string; ipAddress?: string }) {
  const id = cuid();
  const token = randomBytes(32).toString('hex');
  const stamp = nowIso();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  run(
    `INSERT INTO session (id, user_id, token, user_agent, ip_address, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, token, meta?.userAgent ?? null, meta?.ipAddress ?? null, expires, stamp],
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, serializeSessionCookie(id, token), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expires),
  });
  return id;
}

export async function destroySession() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    const [sessionId] = raw.split('.');
    if (sessionId) run('DELETE FROM session WHERE id = ?', [sessionId]);
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Next.js only allows cookie writes inside a Server Action or Route Handler.
 * `getSessionUser` also runs during Server Component render (every protected
 * page), where a delete throws and would turn a stale cookie into a 500 on
 * every page instead of a redirect to /login. Treat the clear as best-effort.
 */
function clearSessionCookie(store: Awaited<ReturnType<typeof cookies>>): void {
  try {
    store.delete(SESSION_COOKIE);
  } catch {
    // Rendering context: nothing to clear. Returning null is enough to send the
    // visitor to the login page, and the browser drops the cookie on sign-in.
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw || !raw.includes('.')) return null;
  const parsed = parseSessionCookie(raw);
  if (!parsed) return null;
  const { sessionId, token } = parsed;
  // Reject tampered cookies before touching the database.
  if (!parsed.signatureValid) {
    clearSessionCookie(store);
    return null;
  }
  const row = get<UserRow & { expires_at: string; session_token: string }>(
    USER_WITH_SESSION_SELECT,
    [sessionId],
  );
  if (!row) return null;
  // Defence in depth: the cookie token must also match the stored token.
  if (!safeEqual(token, row.session_token)) {
    run('DELETE FROM session WHERE id = ?', [sessionId]);
    return null;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run('DELETE FROM session WHERE id = ?', [sessionId]);
    return null;
  }
  if (row.is_active !== 1) return null;
  return toSessionUser(row);
}

export function revokeUserSessions(userId: string): void {
  run('DELETE FROM session WHERE user_id = ?', [userId]);
}
