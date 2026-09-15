/**
 * Session lifecycle tests.
 *
 * `createSession` and `getSessionUser` are two halves of one contract: whatever
 * the writer puts in the cookie, the reader must accept. They are only ever
 * exercised together during a real login, and `authenticate` masks a mismatch
 * behind a generic "Could not start a session" message — so a broken pair fails
 * silently for every user rather than loudly in a test.
 *
 * These tests drive the real implementations against a real SQLite file with a
 * controllable cookie store standing in for `next/headers`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-session-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'session.db')}`;
process.env.SESSION_SECRET = 'test-secret-value-for-hokk-pos-0123456789';

// --- a controllable cookie store -------------------------------------------------
const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'hokk_session' && jar.value ? { name, value: jar.value } : undefined),
    set: (_name: string, value: string) => {
      jar.value = value;
    },
    delete: () => {
      jar.value = undefined;
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { get, run } = await import('@/lib/db');
const { ensureSchema, seedSystemDefaults, createSuperAdmin } = await import('@/lib/bootstrap');
const { createSession, getSessionUser, parseSessionCookie, SESSION_COOKIE } = await import(
  '@/lib/session'
);
const { authenticate } = await import('@/lib/auth');

const EMAIL = 'founder@test.local';
const PASSWORD = 'correct-horse-battery';

beforeAll(() => {
  ensureSchema();
  seedSystemDefaults();
  createSuperAdmin({ email: EMAIL, name: 'Test Founder', password: PASSWORD });
});

beforeEach(() => {
  jar.value = undefined;
  run('DELETE FROM session');
});

describe('session cookie contract', () => {
  it('accepts the cookie that createSession writes', async () => {
    const user = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [EMAIL])!;
    await createSession(user.id);

    expect(jar.value).toBeDefined();
    const session = await getSessionUser();
    expect(session).not.toBeNull();
    expect(session?.email).toBe(EMAIL);
    expect(session?.roleKey).toBe('SUPER_ADMIN');
  });

  it('signs the cookie so tampering is detectable without a database read', async () => {
    const user = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [EMAIL])!;
    await createSession(user.id);

    const parsed = parseSessionCookie(jar.value!);
    expect(parsed).not.toBeNull();
    expect(parsed?.signatureValid).toBe(true);
    // The first segment is the session id (not the user id) and must match the
    // row createSession inserted, or the DB lookup in getSessionUser misses.
    const row = get<{ id: string; user_id: string }>('SELECT id, user_id FROM session WHERE user_id = ?', [
      user.id,
    ])!;
    expect(parsed?.sessionId).toBe(row.id);
    expect(row.user_id).toBe(user.id);

    // Swap in a different token of the same shape: the signature must catch it.
    const forged = `${parsed!.sessionId}.${'f'.repeat(64)}.${jar.value!.split('.')[2]}`;
    expect(parseSessionCookie(forged)?.signatureValid).toBe(false);
  });

  it('rejects a cookie whose signature was tampered with', async () => {
    const user = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [EMAIL])!;
    await createSession(user.id);

    const [id, token, sig] = jar.value!.split('.');
    jar.value = `${id}.${token}.${sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a')}`;

    expect(await getSessionUser()).toBeNull();
    // The stale cookie is cleared rather than retried on every request.
    expect(jar.value).toBeUndefined();
  });

  it('rejects a malformed cookie instead of throwing', async () => {
    jar.value = 'garbage';
    expect(await getSessionUser()).toBeNull();

    jar.value = 'abc.def';
    expect(await getSessionUser()).toBeNull();

    jar.value = 'a.b.c.d';
    expect(await getSessionUser()).toBeNull();
  });

  it('treats a revoked session as signed out', async () => {
    const user = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [EMAIL])!;
    await createSession(user.id);
    expect(await getSessionUser()).not.toBeNull();

    run('DELETE FROM session WHERE user_id = ?', [user.id]);
    expect(await getSessionUser()).toBeNull();
  });

  it('treats an expired session as signed out', async () => {
    const user = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [EMAIL])!;
    await createSession(user.id);
    expect(await getSessionUser()).not.toBeNull();

    run('UPDATE session SET expires_at = ? WHERE user_id = ?', ['2000-01-01T00:00:00.000Z', user.id]);
    expect(await getSessionUser()).toBeNull();
  });

  it('treats a deactivated account as signed out', async () => {
    const user = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [EMAIL])!;
    await createSession(user.id);
    expect(await getSessionUser()).not.toBeNull();

    run('UPDATE "user" SET is_active = 0 WHERE id = ?', [user.id]);
    expect(await getSessionUser()).toBeNull();
    run('UPDATE "user" SET is_active = 1 WHERE id = ?', [user.id]);
  });

  it('keeps the session token opaque and non-derivable from the session id', async () => {
    const user = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [EMAIL])!;
    await createSession(user.id);

    const { sessionId, token } = parseSessionCookie(jar.value!)!;
    // If the token were HMAC(sessionId), anyone who learned the signing secret
    // could mint a session for any id without a database row existing.
    expect(token).not.toBe(jar.value!.split('.')[2]);
    expect(token).toHaveLength(64);
    expect(sessionId).not.toBe(token);
  });
});

describe('authenticate (the login path users actually take)', () => {
  it('signs in with the right password and leaves a usable session', async () => {
    const result = await authenticate(EMAIL, PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.email).toBe(EMAIL);
    expect(jar.value).toBeDefined();
    expect((await getSessionUser())?.id).toBe(result.user.id);
  });

  it('rejects a wrong password without starting a session', async () => {
    const result = await authenticate(EMAIL, 'not-the-password');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Invalid email or password.');
    expect(jar.value).toBeUndefined();
  });

  it('rejects an unknown email without starting a session', async () => {
    const result = await authenticate('nobody@test.local', PASSWORD);
    expect(result.ok).toBe(false);
    expect(jar.value).toBeUndefined();
  });

  it('rejects a deactivated account', async () => {
    const user = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', [EMAIL])!;
    run('UPDATE "user" SET is_active = 0 WHERE id = ?', [user.id]);
    const result = await authenticate(EMAIL, PASSWORD);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('This account has been deactivated.');
    run('UPDATE "user" SET is_active = 1 WHERE id = ?', [user.id]);
  });

  it('records the login in the audit log', async () => {
    await authenticate(EMAIL, PASSWORD);
    const entry = get<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'LOGIN' ORDER BY created_at DESC LIMIT 1",
    );
    expect(entry?.action).toBe('LOGIN');
  });
});

describe('cookie name', () => {
  it('is the name the login and logout paths agree on', () => {
    expect(SESSION_COOKIE).toBe('hokk_session');
  });
});
