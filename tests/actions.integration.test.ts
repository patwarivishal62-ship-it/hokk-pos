/**
 * Integration tests for the server-action layer.
 *
 * The actions are the only code path that writes taxonomy, people and product
 * data from the UI, and they contain hand-written SQL against a schema whose
 * column names are easy to get wrong in ways the type system cannot see
 * (`role` is keyed by `key`, `user` has `role_key`/`is_active`, `category` uses
 * `slug`). These tests run the real actions against a real SQLite file.
 *
 * `next/headers` and `next/cache` only work inside a request, so they are
 * stubbed; everything below them is the shipping implementation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cuid } from '@/lib/id';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-actions-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;
process.env.SESSION_SECRET = 'test-secret-value-for-hokk-pos-0123456789';

// --- request-scoped Next.js APIs --------------------------------------------------
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

// --- auth: a controllable acting user ---------------------------------------------
const authState = vi.hoisted(() => ({
  user: null as null | { id: string; permissions: string[] },
}));

vi.mock('@/lib/auth', () => ({
  requireUser: async () => {
    if (!authState.user) throw new Error('not signed in');
    return {
      id: authState.user.id,
      email: 'admin@test.local',
      name: 'Test Admin',
      roleKey: 'SUPER_ADMIN',
      roleName: 'Super Admin',
      jobTitle: null,
      isActive: true,
      mustChangePassword: false,
      permissions: authState.user.permissions,
    };
  },
  requirePermission: async (permission: string) => {
    if (!authState.user) throw new Error('not signed in');
    const allowed =
      authState.user.permissions.includes('*') || authState.user.permissions.includes(permission);
    if (!allowed) throw new Error(`You do not have permission to ${permission}.`);
    return {
      id: authState.user.id,
      email: 'admin@test.local',
      name: 'Test Admin',
      roleKey: 'SUPER_ADMIN',
      roleName: 'Super Admin',
      jobTitle: null,
      isActive: true,
      mustChangePassword: false,
      permissions: authState.user.permissions,
    };
  },
  userCan: (_user: unknown, _permission: string) => true,
}));

const { all, get, run } = await import('@/lib/db');
const { ensureSchema, seedSystemDefaults, createSuperAdmin } = await import('@/lib/bootstrap');
const {
  saveCategoryAction,
  archiveCategoryAction,
  saveCultureAction,
  saveCollectionAction,
  archiveCollectionAction,
  saveSizeGuideAction,
} = await import('@/app/actions/taxonomy');
const {
  saveUserAction,
  setUserStatusAction,
  saveRoleAction,
  deleteRoleAction,
} = await import('@/app/actions/people');
const { updateProductAction } = await import('@/app/actions/products');
const { createProduct } = await import('@/lib/products');

function form(entries: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

let adminId = '';

beforeEach(() => {
  authState.user = { id: adminId, permissions: ['*'] };
});

describe('server actions', () => {
  const setup = async () => {
    ensureSchema();
    seedSystemDefaults();
    if (!get<{ id: string }>('SELECT id FROM "user" LIMIT 1')) {
      adminId = createSuperAdmin({
        name: 'Test Admin',
        email: 'admin@test.local',
        password: 'test-password-123',
      }).id;
    } else {
      adminId = get<{ id: string }>('SELECT id FROM "user" LIMIT 1')!.id;
    }
    authState.user = { id: adminId, permissions: ['*'] };
  };
  void setup();

  // --- categories -------------------------------------------------------------
  describe('saveCategoryAction', () => {
    it('writes slug and sku_segment, which are the real column names', async () => {
      const result = await saveCategoryAction(null, form({
        name: 'Action Sarees',
        sku_segment: 'ASR',
        template_key: 'SAREE',
        shopify_category: 'Apparel & Accessories > Clothing',
        shopify_type: 'Saree',
      }));
      expect(result.ok).toBe(true);

      const row = get<{ id: string; slug: string; sku_segment: string; template_key: string; shopify_type: string }>(
        'SELECT id, slug, sku_segment, template_key, shopify_type FROM category WHERE name = ?',
        ['Action Sarees'],
      );
      expect(row).toBeTruthy();
      expect(row!.slug).toBe('action-sarees');
      expect(row!.sku_segment).toBe('ASR');
      expect(row!.template_key).toBe('SAREE');
      expect(row!.shopify_type).toBe('Saree');
    });

    it('generates the slug from the name when left blank', async () => {
      await saveCategoryAction(null, form({ name: 'Everyday Wear', template_key: 'APPAREL' }));
      const row = get<{ slug: string }>('SELECT slug FROM category WHERE name = ?', ['Everyday Wear']);
      expect(row!.slug).toBe('everyday-wear');
    });

    it('rejects a duplicate slug', async () => {
      await saveCategoryAction(null, form({ name: 'Dup One', template_key: 'GENERIC' }));
      const result = await saveCategoryAction(null, form({ name: 'Dup Two', slug: 'dup-one', template_key: 'GENERIC' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/already used/i);
    });

    it('updates an existing category in place', async () => {
      await saveCategoryAction(null, form({ name: 'Editable', template_key: 'GENERIC' }));
      const id = get<{ id: string }>('SELECT id FROM category WHERE name = ?', ['Editable'])!.id;
      const result = await saveCategoryAction(null, form({ id, name: 'Edited', template_key: 'APPAREL' }));
      expect(result.ok).toBe(true);
      const row = get<{ name: string; template_key: string }>('SELECT name, template_key FROM category WHERE id = ?', [id]);
      expect(row!.name).toBe('Edited');
      expect(row!.template_key).toBe('APPAREL');
    });

    it('refuses to archive a category still in use', async () => {
      await saveCategoryAction(null, form({ name: 'In Use', sku_segment: 'INU', template_key: 'SAREE' }));
      const categoryId = get<{ id: string }>('SELECT id FROM category WHERE name = ?', ['In Use'])!.id;
      const cultureId = cuid();
      run(
        `INSERT INTO handloom_culture (id, name, slug, code, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
        [cultureId, 'Archive Culture', `archive-culture-${cultureId}`, `AC${cultureId.slice(-3).toUpperCase()}`],
      );
      createProduct({ name: 'Blocking product', categoryId, handloomCultureId: cultureId }, adminId);

      const result = await archiveCategoryAction(null, form({ id: categoryId }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/still use this category/i);
    });
  });

  // --- cultures ---------------------------------------------------------------
  describe('saveCultureAction', () => {
    it('writes the real handloom_culture columns', async () => {
      const result = await saveCultureAction(null, form({
        name: 'Zari Kota',
        code: 'ZK',
        region: 'Kota',
        state: 'Rajasthan',
        technique: 'Khat warp weaving',
        typical_materials: 'Silk and zari',
        typical_motifs: 'Buti',
        significance: 'Woven for royalty',
        history: 'Originated in the 17th century.',
      }));
      expect(result.ok).toBe(true);

      const row = get<{
        slug: string;
        code: string;
        region: string;
        technique: string;
        typical_materials: string;
        typical_motifs: string;
        significance: string;
        history: string;
      }>('SELECT slug, code, region, technique, typical_materials, typical_motifs, significance, history FROM handloom_culture WHERE name = ?', ['Zari Kota']);
      expect(row!.code).toBe('ZK');
      expect(row!.slug).toBe('zari-kota');
      expect(row!.region).toBe('Kota');
      expect(row!.technique).toBe('Khat warp weaving');
      expect(row!.typical_materials).toBe('Silk and zari');
      expect(row!.typical_motifs).toBe('Buti');
      expect(row!.significance).toBe('Woven for royalty');
      expect(row!.history).toContain('17th century');
    });

    it('rejects a duplicate SKU code, since the code appears in SKUs', async () => {
      await saveCultureAction(null, form({ name: 'Baluchari', code: 'BAL' }));
      const result = await saveCultureAction(null, form({ name: 'Baluchari Copy', code: 'BAL' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/already used/i);
    });
  });

  // --- collections ------------------------------------------------------------
  describe('saveCollectionAction', () => {
    it('writes both slug and handle, which are separate NOT NULL columns', async () => {
      const result = await saveCollectionAction(null, form({
        name: 'Festive Edit',
        kind: 'CUSTOMER',
        sort_order: '3',
      }));
      expect(result.ok).toBe(true);
      const row = get<{ slug: string; handle: string; kind: string; sort_order: number }>(
        'SELECT slug, handle, kind, sort_order FROM collection WHERE name = ?',
        ['Festive Edit'],
      );
      expect(row!.slug).toBe('festive-edit');
      expect(row!.handle).toBe('festive-edit');
      expect(row!.kind).toBe('CUSTOMER');
      expect(row!.sort_order).toBe(3);
    });

    it('archives and restores', async () => {
      await saveCollectionAction(null, form({ name: 'Temporary', kind: 'INTERNAL' }));
      const id = get<{ id: string }>('SELECT id FROM collection WHERE name = ?', ['Temporary'])!.id;
      await archiveCollectionAction(null, form({ id }));
      expect(get<{ is_archived: number }>('SELECT is_archived FROM collection WHERE id = ?', [id])!.is_archived).toBe(1);
      await archiveCollectionAction(null, form({ id }));
      expect(get<{ is_archived: number }>('SELECT is_archived FROM collection WHERE id = ?', [id])!.is_archived).toBe(0);
    });
  });

  // --- size guides ------------------------------------------------------------
  describe('saveSizeGuideAction', () => {
    it('creates configurable columns, rows and cells', async () => {
      const result = await saveSizeGuideAction(null, form({
        name: 'Womens Kurta',
        unit: 'cm',
        applies_to: 'Kurtas',
        columns: 'Bust\nWaist\nLength',
        rows: 'S | 36 | 28 | 40\nM | 38 | 30 | 41',
      }));
      expect(result.ok).toBe(true);

      const guideId = get<{ id: string }>('SELECT id FROM size_guide WHERE name = ?', ['Womens Kurta'])!.id;
      const columns = all<{ key: string; label: string }>(
        'SELECT key, label FROM size_guide_column WHERE size_guide_id = ? ORDER BY sort_order',
        [guideId],
      );
      expect(columns.map((column) => column.label)).toEqual(['Bust', 'Waist', 'Length']);
      // The key column is NOT NULL and must be derived, not left empty.
      expect(columns.every((column) => column.key.length > 0)).toBe(true);

      const rows = all<{ id: string; size_label: string }>(
        'SELECT id, size_label FROM size_guide_row WHERE size_guide_id = ? ORDER BY sort_order',
        [guideId],
      );
      expect(rows.map((row) => row.size_label)).toEqual(['S', 'M']);

      const cells = all<{ value: string }>(
        'SELECT value FROM size_guide_cell WHERE row_id = ? ORDER BY value',
        [rows[0].id],
      );
      expect(cells.map((cell) => cell.value).sort()).toEqual(['28', '36', '40']);
    });

    it('requires at least one measurement column', async () => {
      const result = await saveSizeGuideAction(null, form({ name: 'Empty Guide', unit: 'cm', columns: '', rows: '' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/at least one measurement column/i);
    });
  });

  // --- users ------------------------------------------------------------------
  describe('saveUserAction', () => {
    it('writes role_key and is_active, not the non-existent role_id/status', async () => {
      const roleKey = get<{ key: string }>('SELECT key FROM role WHERE key = ?', ['CONTENT'])!.key;
      const result = await saveUserAction(null, form({
        name: 'Ananya Rao',
        email: 'Ananya@Test.Local',
        role_key: roleKey,
        password: 'initial-pass-123',
        job_title: 'Content writer',
      }));
      expect(result.ok).toBe(true);

      const row = get<{ email: string; role_key: string; is_active: number; must_change_password: number }>(
        'SELECT email, role_key, is_active, must_change_password FROM "user" WHERE name = ?',
        ['Ananya Rao'],
      );
      expect(row!.email).toBe('ananya@test.local');
      expect(row!.role_key).toBe('CONTENT');
      expect(row!.is_active).toBe(1);
      expect(row!.must_change_password).toBe(1);
    });

    it('rejects a duplicate email', async () => {
      const roleKey = get<{ key: string }>('SELECT key FROM role LIMIT 1')!.key;
      await saveUserAction(null, form({ name: 'First', email: 'dupe@test.local', role_key: roleKey, password: 'password-123' }));
      const result = await saveUserAction(null, form({ name: 'Second', email: 'dupe@test.local', role_key: roleKey, password: 'password-123' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/already exists/i);
    });

    it('rejects a weak password', async () => {
      const roleKey = get<{ key: string }>('SELECT key FROM role LIMIT 1')!.key;
      const result = await saveUserAction(null, form({ name: 'Weak', email: 'weak@test.local', role_key: roleKey, password: 'abc' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/password/i);
    });

    it('refuses to deactivate the super admin', async () => {
      // Act as someone else, so this reaches the super-admin guard rather than
      // the earlier "you cannot change your own status" check.
      authState.user = { id: cuid(), permissions: ['user.manage'] };
      const result = await setUserStatusAction(null, form({ id: adminId, is_active: '0' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/super admin/i);
      expect(get<{ is_active: number }>('SELECT is_active FROM "user" WHERE id = ?', [adminId])!.is_active).toBe(1);
      authState.user = { id: adminId, permissions: ['*'] };
    });

    it('deactivates a normal user and revokes their sessions', async () => {
      const roleKey = get<{ key: string }>('SELECT key FROM role WHERE key = ?', ['VIEWER'])!.key;
      await saveUserAction(null, form({ name: 'Viewer One', email: 'viewer@test.local', role_key: roleKey, password: 'password-123' }));
      const userId = get<{ id: string }>('SELECT id FROM "user" WHERE email = ?', ['viewer@test.local'])!.id;
      run(`INSERT INTO session (id, user_id, token, expires_at, created_at)
           VALUES (?, ?, ?, datetime('now','+1 day'), datetime('now'))`, [
        cuid(),
        userId,
        'tok',
      ]);

      const result = await setUserStatusAction(null, form({ id: userId, is_active: '0' }));
      expect(result.ok).toBe(true);
      expect(get<{ is_active: number }>('SELECT is_active FROM "user" WHERE id = ?', [userId])!.is_active).toBe(0);
      expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM session WHERE user_id = ?', [userId])!.n).toBe(0);
    });
  });

  // --- roles ------------------------------------------------------------------
  describe('saveRoleAction', () => {
    it('creates a role keyed by a derived key, since role has no id column', async () => {
      const result = await saveRoleAction(null, form({
        name: 'Merchandiser',
        description: 'Prices and inventory',
        permissions: 'product.view',
      }));
      expect(result.ok).toBe(true);
      const row = get<{ key: string; permissions: string; is_system: number }>(
        'SELECT key, permissions, is_system FROM role WHERE name = ?',
        ['Merchandiser'],
      );
      expect(row!.key).toBe('MERCHANDISER');
      expect(JSON.parse(row!.permissions)).toEqual(['product.view']);
      expect(row!.is_system).toBe(0);
    });

    it('stores a wildcard when full access is requested', async () => {
      await saveRoleAction(null, form({ name: 'Ops Owner', wildcard: '1' }));
      const row = get<{ permissions: string }>('SELECT permissions FROM role WHERE name = ?', ['Ops Owner']);
      expect(JSON.parse(row!.permissions)).toEqual(['*']);
    });

    it('refuses to delete a built-in role', async () => {
      const result = await deleteRoleAction(null, form({ id: 'SUPER_ADMIN' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/built-in/i);
    });

    it('refuses to delete a role still assigned to a user', async () => {
      await saveRoleAction(null, form({ name: 'Occupied', permissions: 'product.view' }));
      await saveUserAction(null, form({ name: 'Held By', email: 'held@test.local', role_key: 'OCCUPIED', password: 'password-123' }));
      const result = await deleteRoleAction(null, form({ id: 'OCCUPIED' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/still hold this role/i);
    });
  });

  // --- permission enforcement ---------------------------------------------------
  describe('permission enforcement', () => {
    it('blocks a taxonomy write for a user without the permission', async () => {
      authState.user = { id: adminId, permissions: ['product.view'] };
      const result = await saveCategoryAction(null, form({ name: 'Should Fail', template_key: 'GENERIC' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/permission/i);
      expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM category WHERE name = ?', ['Should Fail'])!.n).toBe(0);
      authState.user = { id: adminId, permissions: ['*'] };
    });
  });

  // --- product update -----------------------------------------------------------
  describe('updateProductAction', () => {
    it('reads product_id from the form data', async () => {
      const product = createProduct({ name: 'Action Product', price: 100 }, adminId);
      const result = await updateProductAction(null, form({
        product_id: product.id,
        colour: 'Teal',
        fabric: 'Cotton',
      }));
      expect(result.ok).toBe(true);
      const row = get<{ colour: string; fabric: string }>('SELECT colour, fabric FROM product WHERE id = ?', [product.id]);
      expect(row!.colour).toBe('Teal');
      expect(row!.fabric).toBe('Cotton');
    });

    it('fails cleanly when product_id is absent', async () => {
      const result = await updateProductAction(null, form({ colour: 'Teal' }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/product_id/i);
    });

    it('does not let a non-privileged user change the SKU', async () => {
      const product = createProduct({ name: 'Guarded SKU', price: 100 }, adminId);
      authState.user = { id: adminId, permissions: ['product.edit'] };
      const result = await updateProductAction(null, form({ product_id: product.id, sku: 'HIJACKED-001' }));
      expect(result.ok).toBe(true);
      expect(get<{ sku: string }>('SELECT sku FROM product WHERE id = ?', [product.id])!.sku).not.toBe('HIJACKED-001');
      authState.user = { id: adminId, permissions: ['*'] };
    });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
