import 'server-only';
import { redirect } from 'next/navigation';
import { get, run } from '@/lib/db';
import { nowIso } from '@/lib/id';
import { verifyPassword } from '@/lib/password';
import { createSession, getSessionUser, type SessionUser } from '@/lib/session';
import { hasPermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import type { UserRow } from '@/lib/types';

export class AuthError extends Error {}

export async function authenticate(
  email: string,
  password: string,
  meta?: { userAgent?: string; ipAddress?: string },
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const normalized = email.trim().toLowerCase();
  const row = get<UserRow>(
    `SELECT u.*, r.name AS role_name, r.permissions AS role_permissions
     FROM "user" u JOIN role r ON r.key = u.role_key
     WHERE lower(u.email) = ?`,
    [normalized],
  );
  if (!row) return { ok: false, error: 'Invalid email or password.' };
  if (row.is_active !== 1) return { ok: false, error: 'This account has been deactivated.' };
  if (!verifyPassword(password, row.password_hash)) {
    return { ok: false, error: 'Invalid email or password.' };
  }
  await createSession(row.id, meta);
  run('UPDATE "user" SET last_login_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), row.id]);
  logAudit({
    entityType: 'USER',
    entityId: row.id,
    entityLabel: row.email,
    action: 'LOGIN',
    userId: row.id,
  });
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Could not start a session. Please try again.' };
  return { ok: true, user };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export async function requirePermission(permission: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user.permissions, permission)) {
    throw new AuthError(`You do not have permission to ${permission}.`);
  }
  return user;
}

export function userCan(user: SessionUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  return hasPermission(user.permissions, permission);
}
