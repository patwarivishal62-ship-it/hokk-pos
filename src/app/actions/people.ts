'use server';

import { revalidatePath } from 'next/cache';
import { get, run } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { requirePermission, requireUser } from '@/lib/auth';
import { hashPassword, passwordIssues } from '@/lib/password';
import { diffRecords, logAudit } from '@/lib/audit';

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function saveUserAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission('user.manage');
    const id = String(formData.get('id') ?? '');
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const name = String(formData.get('name') ?? '').trim();
    if (!email) return { ok: false, error: 'Email is required.' };
    if (!name) return { ok: false, error: 'Name is required.' };
    const roleKey = String(formData.get('role_key') ?? '');
    const role = get<{ key: string; name: string }>('SELECT key, name FROM role WHERE key = ?', [roleKey]);
    if (!role) return { ok: false, error: 'Choose a role.' };

    if (id) {
      const before = get<Record<string, unknown>>('SELECT * FROM "user" WHERE id = ?', [id]);
      if (!before) return { ok: false, error: 'User not found.' };
      const duplicate = get<{ id: string }>('SELECT id FROM "user" WHERE email = ? AND id != ?', [email, id]);
      if (duplicate) return { ok: false, error: 'Another user already uses that email.' };
      run('UPDATE "user" SET email = ?, name = ?, role_key = ?, phone = ?, job_title = ?, updated_at = ? WHERE id = ?', [
        email,
        name,
        roleKey,
        String(formData.get('phone') ?? '').trim() || null,
        String(formData.get('job_title') ?? '').trim() || null,
        nowIso(),
        id,
      ]);
      logAudit({
        entityType: 'USER',
        entityId: id,
        entityLabel: email,
        action: 'EDIT',
        userId: actor.id,
        changes: diffRecords(before, get<Record<string, unknown>>('SELECT * FROM "user" WHERE id = ?', [id])),
      });
      revalidatePath('/users');
      return { ok: true, message: `${name} updated.` };
    }

    const password = String(formData.get('password') ?? '');
    const issues = passwordIssues(password);
    if (issues.length > 0) return { ok: false, error: `Password: ${issues.join('; ')}` };
    const duplicate = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [email]);
    if (duplicate) return { ok: false, error: 'A user with that email already exists.' };

    const newId = cuid();
    run(
      `INSERT INTO "user" (id, email, name, role_key, password_hash, is_active, must_change_password, phone, job_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
      [
        newId,
        email,
        name,
        roleKey,
        hashPassword(password),
        String(formData.get('phone') ?? '').trim() || null,
        String(formData.get('job_title') ?? '').trim() || null,
        nowIso(),
        nowIso(),
      ],
    );
    logAudit({ entityType: 'USER', entityId: newId, entityLabel: email, action: 'CREATE', userId: actor.id, meta: { role: role.name } });
    revalidatePath('/users');
    revalidatePath('/dashboard');
    return { ok: true, message: `${name} added as ${role.name}.` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function setUserStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission('user.manage');
    const id = String(formData.get('id') ?? '');
    const active = formData.get('is_active') === '1';
    const user = get<{ id: string; name: string; email: string; role_key: string; is_active: number }>(
      'SELECT id, name, email, role_key, is_active FROM "user" WHERE id = ?',
      [id],
    );
    if (!user) return { ok: false, error: 'User not found.' };
    if (user.id === actor.id) return { ok: false, error: 'You cannot change your own status.' };
    if (user.role_key === 'SUPER_ADMIN') return { ok: false, error: 'The super admin cannot be deactivated.' };
    run('UPDATE "user" SET is_active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, nowIso(), id]);
    if (!active) run('DELETE FROM session WHERE user_id = ?', [id]);
    logAudit({
      entityType: 'USER',
      entityId: id,
      entityLabel: user.email,
      action: active ? 'USER_ACTIVATE' : 'USER_DEACTIVATE',
      userId: actor.id,
      changes: [{ field: 'is_active', label: 'Active', oldValue: user.is_active, newValue: active ? 1 : 0 }],
    });
    revalidatePath('/users');
    return { ok: true, message: `${user.name} is now ${active ? 'active' : 'inactive'}.` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function resetUserPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission('user.manage');
    const id = String(formData.get('id') ?? '');
    const password = String(formData.get('password') ?? '');
    const issues = passwordIssues(password);
    if (issues.length > 0) return { ok: false, error: `Password: ${issues.join('; ')}` };
    const user = get<{ id: string; email: string }>('SELECT id, email FROM "user" WHERE id = ?', [id]);
    if (!user) return { ok: false, error: 'User not found.' };
    run('UPDATE "user" SET password_hash = ?, updated_at = ? WHERE id = ?', [hashPassword(password), nowIso(), id]);
    run('DELETE FROM session WHERE user_id = ?', [id]);
    logAudit({
      entityType: 'USER',
      entityId: id,
      entityLabel: user.email,
      action: 'PASSWORD_RESET',
      userId: actor.id,
      meta: { by: 'admin' },
    });
    revalidatePath('/users');
    return { ok: true, message: 'Password reset. The user has been signed out everywhere.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function saveRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission('role.manage');
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { ok: false, error: 'Role name is required.' };
    const permissions = formData
      .getAll('permissions')
      .map((value) => String(value))
      .filter(Boolean);
    const wildcard = formData.get('wildcard') === '1';
    const finalPermissions = wildcard ? ['*'] : permissions;
    const description = String(formData.get('description') ?? '').trim() || null;

    if (id) {
      const role = get<{ key: string; name: string; is_system: number }>('SELECT key, name, is_system FROM role WHERE key = ?', [id]);
      if (!role) return { ok: false, error: 'Role not found.' };
      run('UPDATE role SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE key = ?', [
        name,
        description,
        JSON.stringify(finalPermissions),
        id,
      ]);
      logAudit({
        entityType: 'ROLE',
        entityId: id,
        entityLabel: name,
        action: 'EDIT',
        userId: actor.id,
        changes: [{ field: 'permissions', label: 'Permissions', oldValue: role.name, newValue: finalPermissions.join(', ') }],
      });
      revalidatePath('/roles');
      return { ok: true, message: `Role “${name}” updated.` };
    }

    const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    if (get<{ key: string }>('SELECT key FROM role WHERE key = ?', [key])) {
      return { ok: false, error: `A role with the key “${key}” already exists.` };
    }
    run('INSERT INTO role (key, name, description, permissions, is_system, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 99, ?, ?)', [
      key,
      name,
      description,
      JSON.stringify(finalPermissions),
      nowIso(),
      nowIso(),
    ]);
    logAudit({ entityType: 'ROLE', entityId: key, entityLabel: name, action: 'CREATE', userId: actor.id });
    revalidatePath('/roles');
    return { ok: true, message: `Role “${name}” created.` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function deleteRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requirePermission('role.manage');
    const id = String(formData.get('id') ?? '');
    const role = get<{ key: string; name: string; is_system: number }>('SELECT key, name, is_system FROM role WHERE key = ?', [id]);
    if (!role) return { ok: false, error: 'Role not found.' };
    if (role.is_system === 1) return { ok: false, error: 'Built-in roles cannot be deleted — remove their permissions instead.' };
    const inUse = get<{ n: number }>('SELECT COUNT(*) AS n FROM "user" WHERE role_key = ?', [id])?.n ?? 0;
    if (inUse > 0) return { ok: false, error: `${inUse} user(s) still hold this role.` };
    run('DELETE FROM role WHERE key = ?', [id]);
    logAudit({ entityType: 'ROLE', entityId: id, entityLabel: role.name, action: 'DELETE', userId: actor.id });
    revalidatePath('/roles');
    return { ok: true, message: `Role “${role.name}” deleted.` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function changeMyPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const current = String(formData.get('current_password') ?? '');
    const next = String(formData.get('new_password') ?? '');
    const confirm = String(formData.get('confirm_password') ?? '');
    if (next !== confirm) return { ok: false, error: 'The new password and confirmation do not match.' };
    const issues = passwordIssues(next);
    if (issues.length > 0) return { ok: false, error: `Password: ${issues.join('; ')}` };
    const row = get<{ password_hash: string }>('SELECT password_hash FROM "user" WHERE id = ?', [user.id]);
    if (!row) return { ok: false, error: 'User not found.' };
    const { verifyPassword } = await import('@/lib/password');
    if (!verifyPassword(current, row.password_hash)) return { ok: false, error: 'Your current password is incorrect.' };
    run('UPDATE "user" SET password_hash = ?, updated_at = ? WHERE id = ?', [hashPassword(next), nowIso(), user.id]);
    logAudit({ entityType: 'USER', entityId: user.id, entityLabel: user.email, action: 'PASSWORD_CHANGE', userId: user.id });
    return { ok: true, message: 'Password changed.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

