/**
 * Integration test over a real SQLite file: exercises schema creation, system
 * bootstrap, SKU generation, product CRUD, the audit trail, workflow gating and
 * the derived completeness/readiness caches.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cuid, nowIso } from '@/lib/id';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-db-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;
process.env.SESSION_SECRET = 'test-secret-value-for-hokk-pos-0123456789';

// Imported after the environment is configured.
const { all, get, run } = await import('@/lib/db');
const { ensureSchema, seedSystemDefaults, createSuperAdmin, isInitialized } = await import('@/lib/bootstrap');
const {
  createProduct,
  updateProduct,
  setAttributeValues,
  setProductStatus,
  archiveProduct,
  deleteProduct,
  listProducts,
  loadBundle,
  recomputeProduct,
  setProductCollections,
  getProduct,
} = await import('@/lib/products');
const { queryAudit, parseChanges } = await import('@/lib/audit');
const { canTransition } = await import('@/lib/workflow');

let adminId = '';
let sareeCategoryId = '';
let zariKotaId = '';

function insertCategory(name: string, segment: string, templateKey: string): string {
  const id = cuid();
  run(
    `INSERT INTO category (id, name, slug, sku_segment, template_key, is_archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, name, name.toLowerCase().replace(/\s+/g, '-'), segment, templateKey, nowIso(), nowIso()],
  );
  return id;
}

function insertCulture(name: string, code: string): string {
  const id = cuid();
  run(
    `INSERT INTO handloom_culture (id, name, slug, code, region, state, is_archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Rajasthan', 'Rajasthan', 0, ?, ?)`,
    [id, name, name.toLowerCase().replace(/\s+/g, '-'), code, nowIso(), nowIso()],
  );
  return id;
}

function insertCollection(name: string): string {
  const id = cuid();
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  run(
    `INSERT INTO collection (id, name, slug, handle, kind, is_archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'CUSTOMER', 0, ?, ?)`,
    [id, name, slug, slug, nowIso(), nowIso()],
  );
  return id;
}

beforeAll(() => {
  ensureSchema();
  seedSystemDefaults();
  adminId = createSuperAdmin({
    name: 'Vishal Patwari',
    email: 'founder@houseofkalakatha.com',
    password: 'KalaKatha#2026',
  }).id;
  sareeCategoryId = insertCategory('Sarees', 'SAR', 'SAREE');
  insertCategory('T-Shirts', 'APP', 'APPAREL');
  zariKotaId = insertCulture('Zari Kota', 'ZK');
  insertCulture('Baluchari', 'BAL');
  insertCollection('Handloom Stories');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('bootstrap', () => {
  it('creates the schema, roles, settings and image slot templates', () => {
    expect(isInitialized()).toBe(true);
    const roles = all<{ key: string }>('SELECT key FROM role').map((r) => r.key);
    expect(roles).toEqual(expect.arrayContaining(['SUPER_ADMIN', 'ADMIN', 'CONTENT', 'PHOTOGRAPHY', 'REVIEWER', 'VIEWER']));

    const settings = all<{ key: string }>('SELECT key FROM setting').map((r) => r.key);
    expect(settings).toContain('sku.pattern');

    const slots = all<{ label: string; file_suffix: string }>(
      `SELECT s.label, s.file_suffix FROM image_slot_definition s
       JOIN image_slot_template t ON t.id = s.template_id WHERE t.key = 'SAREE' ORDER BY s.sort_order`,
    );
    expect(slots.map((s) => s.file_suffix)).toEqual(['HERO', 'FULL', 'DETAIL', 'PALLU', 'BORDER', 'FABRIC', 'BLOUSE', 'EDITORIAL']);

    const mapping = all<{ column: string }>('SELECT column FROM shopify_field_mapping').map((r) => r.column);
    expect(mapping).toContain('URL handle');
    expect(mapping).toContain('Product image URL');
  });

  it('seeds no catalog data', () => {
    expect(get<{ c: number }>('SELECT COUNT(*) AS c FROM product')?.c).toBe(0);
    expect(get<{ c: number }>('SELECT COUNT(*) AS c FROM handloom_culture')?.c).toBe(2);
  });

  it('refuses to create a second bootstrap admin', () => {
    expect(() => createSuperAdmin({ name: 'X', email: 'x@y.z', password: 'Password#123' })).toThrow(
      /already initialised/,
    );
  });
});

describe('SKU generation (spec §3)', () => {
  it('builds HOKK-SAR-ZK-001 from the configured pattern', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    expect(product.sku).toBe('HOKK-SAR-ZK-001');
  });

  it('increments within the culture scope', () => {
    const second = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    expect(second.sku).toBe('HOKK-SAR-ZK-002');
  });

  it('restarts the sequence for a different culture', () => {
    const baluchariId = get<{ id: string }>('SELECT id FROM handloom_culture WHERE code = ?', ['BAL'])!.id;
    const third = createProduct({ categoryId: sareeCategoryId, handloomCultureId: baluchariId }, adminId);
    expect(third.sku).toBe('HOKK-SAR-BAL-001');
  });

  it('never reuses a deleted SKU', () => {
    const first = get<{ id: string; sku: string }>('SELECT id, sku FROM product WHERE sku = ?', ['HOKK-SAR-ZK-001'])!;
    deleteProduct(first.id, adminId);
    const next = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    expect(next.sku).toBe('HOKK-SAR-ZK-003');
  });

  it('creates a default variant carrying the product SKU', () => {
    const product = get<{ id: string; sku: string }>('SELECT id, sku FROM product ORDER BY created_at LIMIT 1')!;
    const variants = all<{ sku: string; option1_value: string }>('SELECT sku, option1_value FROM variant WHERE product_id = ?', [
      product.id,
    ]);
    expect(variants).toHaveLength(1);
    expect(variants[0].option1_value).toBe('Default Title');
  });
});

describe('product updates and the audit trail (spec §27)', () => {
  it('generates a handle from the name and records the change', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    const { changes } = updateProduct(product.id, { name: 'Amara — Zari Kota' }, adminId);

    const updated = getProduct(product.id)!;
    expect(updated.handle).toBe('amara-zari-kota');
    expect(updated.name_status).toBe('NAME_PROPOSED');
    expect(changes.some((c) => c.field === 'name')).toBe(true);
    expect(changes.some((c) => c.field === 'handle')).toBe(true);

    const audit = queryAudit({ entityType: 'PRODUCT', entityId: product.id });
    const nameEntry = audit.rows.find((row) => parseChanges(row.changes).some((c) => c.field === 'name'));
    expect(nameEntry).toBeDefined();
    const change = parseChanges(nameEntry!.changes).find((c) => c.field === 'name')!;
    expect(change.label).toBe('Product name');
    expect(change.oldValue).toBeNull();
    expect(change.newValue).toBe('Amara — Zari Kota');
  });

  it('does not log an entry when nothing actually changed', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    updateProduct(product.id, { colour: 'Indigo' }, adminId);
    const before = queryAudit({ entityType: 'PRODUCT', entityId: product.id }).total;
    const { changes } = updateProduct(product.id, { colour: 'Indigo' }, adminId);
    expect(changes).toEqual([]);
    expect(queryAudit({ entityType: 'PRODUCT', entityId: product.id }).total).toBe(before);
  });

  it('keeps a manually locked handle untouched', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    updateProduct(product.id, { name: 'Bala Baluchari', handle: 'bala-custom', handle_locked: 1 }, adminId);
    updateProduct(product.id, { name: 'Bala Baluchari Renamed' }, adminId);
    expect(getProduct(product.id)!.handle).toBe('bala-custom');
  });

  it('snapshots critical fields before each edit', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    updateProduct(product.id, { name: 'First Name' }, adminId);
    updateProduct(product.id, { name: 'Second Name', price: 9999 }, adminId);
    const snapshots = all<{ version: number }>(
      'SELECT version FROM product_snapshot WHERE product_id = ? ORDER BY version',
      [product.id],
    );
    expect(snapshots.map((s) => s.version)).toEqual([1, 2]);
  });

  it('records attribute edits with the MISSING marker', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    const field = get<{ id: string }>(
      `SELECT id FROM attribute_field WHERE template_key = 'SAREE' AND key = 'zari_purity'`,
    )!;
    setAttributeValues(product.id, [{ fieldId: field.id, value: '', isMissing: true }], adminId);

    const stored = get<{ value: string; is_missing: number }>(
      'SELECT value, is_missing FROM product_attribute_value WHERE product_id = ?',
      [product.id],
    )!;
    expect(stored.is_missing).toBe(1);

    const audit = queryAudit({ entityType: 'PRODUCT', entityId: product.id });
    const entry = audit.rows
      .flatMap((row) => parseChanges(row.changes))
      .find((c) => c.field === `attr:${field.id}`);
    expect(entry?.newValue).toBe('MISSING — INFORMATION REQUIRED');
  });
});

describe('derived caches', () => {
  it('computes completeness and photography counters', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    const { completeness } = recomputeProduct(product.id);
    expect(completeness).toBeGreaterThan(0);
    expect(completeness).toBeLessThan(100);

    const row = get<{ completeness_score: number; photography_required: number; readiness_state: string }>(
      'SELECT completeness_score, photography_required, readiness_state FROM product WHERE id = ?',
      [product.id],
    )!;
    expect(row.completeness_score).toBe(completeness);
    expect(row.photography_required).toBe(6);
    expect(row.readiness_state).toBe('BLOCKED');
  });

  it('records readiness issues as JSON', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    const issues = JSON.parse(get<{ readiness_issues: string }>('SELECT readiness_issues FROM product WHERE id = ?', [product.id])!.readiness_issues) as Array<{ code: string }>;
    expect(issues.map((i) => i.code)).toContain('MISSING_NAME');
    expect(issues.map((i) => i.code)).toContain('NO_IMAGES');
  });
});

describe('workflow gating (spec §6)', () => {
  it('refuses Shopify readiness while the product is incomplete', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    const row = getProduct(product.id)!;
    const check = canTransition('FOUNDER_APPROVAL', 'SHOPIFY_READY', {
      readinessState: row.readiness_state,
      permissions: ['*'],
    });
    expect(check.allowed).toBe(false);
  });

  it('records a status change and a review decision', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    setProductStatus(product.id, 'CONTENT_REVIEW', adminId);
    expect(getProduct(product.id)!.status).toBe('CONTENT_REVIEW');

    setProductStatus(product.id, 'CHANGES_REQUESTED', adminId, {
      decision: 'CHANGES_REQUESTED',
      comment: 'Need a better pallu image.',
      checklist: { images: false },
    });
    const review = get<{ decision: string; comment: string }>(
      'SELECT decision, comment FROM product_review WHERE product_id = ?',
      [product.id],
    )!;
    expect(review.decision).toBe('CHANGES_REQUESTED');
    expect(review.comment).toBe('Need a better pallu image.');
  });

  it('archives and restores', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    archiveProduct(product.id, true, adminId);
    expect(getProduct(product.id)!.is_archived).toBe(1);
    expect(listProducts({}).rows.some((r) => r.id === product.id)).toBe(false);
    expect(listProducts({ archived: true }).rows.some((r) => r.id === product.id)).toBe(true);
    archiveProduct(product.id, false, adminId);
    expect(getProduct(product.id)!.is_archived).toBe(0);
  });
});

describe('catalog queries and filters', () => {
  it('searches by SKU', () => {
    const { rows } = listProducts({ search: 'HOKK-SAR-BAL' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.sku.includes('BAL'))).toBe(true);
  });

  it('filters by culture and category together', () => {
    const { rows } = listProducts({ categoryId: sareeCategoryId, cultureId: zariKotaId });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.handloom_culture_id === zariKotaId)).toBe(true);
    expect(rows[0].culture_name).toBe('Zari Kota');
  });

  it('finds products with incomplete photography', () => {
    const { rows } = listProducts({ missingPhotography: true });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.photography_complete < r.photography_required)).toBe(true);
  });

  it('paginates', () => {
    const all1 = listProducts({ limit: 2, offset: 0 });
    const all2 = listProducts({ limit: 2, offset: 2 });
    expect(all1.rows).toHaveLength(2);
    expect(all1.total).toBeGreaterThan(2);
    expect(all1.rows.map((r) => r.id).some((id) => all2.rows.map((r) => r.id).includes(id))).toBe(false);
  });
});

describe('collections', () => {
  it('assigns and unassigns collections with an audit entry', () => {
    const product = createProduct({ categoryId: sareeCategoryId, handloomCultureId: zariKotaId }, adminId);
    const collectionId = get<{ id: string }>('SELECT id FROM collection LIMIT 1')!.id;
    setProductCollections(product.id, [collectionId], adminId);
    expect(loadBundle(product.id)!.collections).toHaveLength(1);

    setProductCollections(product.id, [], adminId);
    expect(loadBundle(product.id)!.collections).toHaveLength(0);

    const audit = queryAudit({ entityType: 'PRODUCT', entityId: product.id });
    const entry = audit.rows.flatMap((r) => parseChanges(r.changes)).find((c) => c.field === 'collections');
    expect(entry).toBeDefined();
  });
});
