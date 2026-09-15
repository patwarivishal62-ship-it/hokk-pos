'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { authenticate, getCurrentUser } from '@/lib/auth';
import { destroySession } from '@/lib/session';
import { createSuperAdmin, isInitialized } from '@/lib/bootstrap';
import { hashPassword, passwordIssues } from '@/lib/password';
import { get, run } from '@/lib/db';
import { nowIso } from '@/lib/id';
import { logAudit } from '@/lib/audit';
import { revokeUserSessions } from '@/lib/session';

async function requestMeta() {
  const store = await headers();
  return {
    userAgent: store.get('user-agent') ?? undefined,
    ipAddress: store.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  };
}

export async function loginAction(_prev: { error?: string } | null, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  const result = await authenticate(email, password, await requestMeta());
  if (!result.ok) return { error: result.error };
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function logoutAction() {
  await destroySession();
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function setupAction(_prev: { error?: string } | null, formData: FormData) {
  if (isInitialized()) return { error: 'The system is already initialised.' };
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (name.length < 2) return { error: 'Enter your full name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };
  const problems = passwordIssues(password);
  if (problems.length > 0) return { error: problems.join(' ') };
  if (password !== confirm) return { error: 'Passwords do not match.' };

  try {
    createSuperAdmin({ name, email, password });
  } catch (error) {
    return { error: (error as Error).message };
  }
  await authenticate(email, password, await requestMeta());
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function changePasswordAction(_prev: { error?: string; ok?: boolean } | null, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return { error: 'You must be signed in.' };
  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  const row = get<{ password_hash: string }>('SELECT password_hash FROM "user" WHERE id = ?', [user.id]);
  if (!row) return { error: 'Account not found.' };
  const { verifyPassword } = await import('@/lib/password');
  if (!verifyPassword(current, row.password_hash)) return { error: 'Your current password is incorrect.' };
  const problems = passwordIssues(next);
  if (problems.length > 0) return { error: problems.join(' ') };
  if (next !== confirm) return { error: 'Passwords do not match.' };

  run('UPDATE "user" SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [
    hashPassword(next),
    nowIso(),
    user.id,
  ]);
  revokeUserSessions(user.id);
  logAudit({ entityType: 'USER', entityId: user.id, entityLabel: user.email, action: 'PASSWORD_CHANGE', userId: user.id });
  redirect('/login?reason=password-changed');
}
