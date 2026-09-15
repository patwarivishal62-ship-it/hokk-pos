/**
 * Import safety (spec §36): a blind import is never allowed. The file is parsed,
 * columns are detected and mapped, rows are previewed and validated, duplicates
 * are flagged, and only then is anything written.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cuid } from '@/lib/id';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-import-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;
process.env.SESSION_SECRET = 'test-secret-value-for-hokk-pos-0123456789';

const { all, get, run } = await import('@/lib/db');
const { ensureSchema, seedSystemDefaults, createSuperAdmin } = await import('@/lib/bootstrap');
const { detectMapping, buildPreview, applyImport } = await import('@/lib/importer');

ensureSchema();
seedSystemDefaults();
const adminId = createSuperAdmin({
  name: 'Import Admin',
  email: 'import@test.local',
  password: 'test-password-123',
}).id;

function seedCategory(name: string, segment: string, templateKey: string): string {
  const id = cuid();
  run(
    `INSERT INTO category (id, name, slug, sku_segment, template_key, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    [id, name, name.toLowerCase().replace(/\s+/g, '-'), segment, templateKey],
  );
  return id;
}

const sareeCategoryId = seedCategory('Sarees', 'SAR', 'SAREE');

describe('detectMapping', () => {
  it('recognises the current Shopify product CSV headers', () => {
    const mapping = detectMapping([
      'Title',
      'URL handle',
      'Description',
      'Vendor',
      'Product category',
      'Type',
      'Tags',
      'Published on online store',
      'Status',
      'SKU',
      'Price',
      'Compare-at price',
      'Inventory quantity',
      'Product image URL',
      'Image alt text',
      'SEO title',
      'SEO description',
    ]);
    expect(mapping.name).toBe('Title');
    expect(mapping.handle).toBe('URL handle');
    expect(mapping.full_description).toBe('Description');
    expect(mapping.sku).toBe('SKU');
    expect(mapping.price).toBe('Price');
    expect(mapping.compare_at_price).toBe('Compare-at price');
    expect(mapping.inventory_qty).toBe('Inventory quantity');
    expect(mapping.image_url).toBe('Product image URL');
    expect(mapping.seo_title).toBe('SEO title');
  });

  it('recognises the legacy headers too', () => {
    const mapping = detectMapping(['Title', 'Handle', 'Body (HTML)', 'Variant Price', 'Variant Inventory Qty', 'Image Src']);
    expect(mapping.handle).toBe('Handle');
    expect(mapping.full_description).toBe('Body (HTML)');
    expect(mapping.price).toBe('Variant Price');
    expect(mapping.inventory_qty).toBe('Variant Inventory Qty');
    expect(mapping.image_url).toBe('Image Src');
  });

  it('returns nothing recognisable for an unrelated header row', () => {
    expect(detectMapping(['Foo', 'Bar', 'Baz'])).toEqual({});
  });
});

describe('buildPreview', () => {
  const csv = [
    'Title,SKU,Category,Price,Handle',
    'Maroon Zari Kota,HOKK-SAR-ZK-101,Sarees,12500,maroon-zari-kota',
    'Indigo Banarasi,HOKK-SAR-BAN-102,Sarees,9800,indigo-banarasi',
  ].join('\n');
  const mapping = { name: 'Title', sku: 'SKU', category: 'Category', price: 'Price', handle: 'Handle' };

  it('parses every row and maps the columns', () => {
    const preview = buildPreview(csv, mapping, 'NEW');
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0].mapped.name).toBe('Maroon Zari Kota');
    expect(preview.rows[0].mapped.sku).toBe('HOKK-SAR-ZK-101');
    expect(preview.rows[0].mapped.price).toBe(12500);
    // The category name resolves to an id, because the category must exist.
    expect(preview.rows[0].mapped.category_id).toBe(sareeCategoryId);
    expect(preview.summary.total).toBe(2);
  });

  it('flags a negative price as an error', () => {
    const preview = buildPreview('Title,SKU,Price\nBad,HOKK-X-001,-500', { name: 'Title', sku: 'SKU', price: 'Price' }, 'NEW');
    const errors = preview.rows[0].issues.filter((issue) => issue.severity === 'ERROR');
    expect(errors.some((issue) => issue.code === 'NEGATIVE_VALUE')).toBe(true);
  });

  it('flags a non-numeric price as an error', () => {
    const preview = buildPreview('Title,SKU,Price\nBad,HOKK-X-002,not-a-number', { name: 'Title', sku: 'SKU', price: 'Price' }, 'NEW');
    expect(preview.rows[0].issues.some((issue) => issue.code === 'INVALID_NUMBER')).toBe(true);
  });

  it('flags a category that does not exist rather than creating one', () => {
    const preview = buildPreview('Title,SKU,Category\nOrphan,HOKK-X-003,Nonexistent', { name: 'Title', sku: 'SKU', category: 'Category' }, 'NEW');
    expect(preview.rows[0].issues.some((issue) => issue.code === 'UNKNOWN_CATEGORY')).toBe(true);
    expect(preview.rows[0].mapped.category_id).toBeNull();
  });

  it('flags a row with no name', () => {
    const preview = buildPreview('Title,SKU\n,HOKK-X-004', { name: 'Title', sku: 'SKU' }, 'NEW');
    expect(preview.rows[0].issues.some((issue) => issue.code === 'MISSING_NAME')).toBe(true);
  });

  it('counts rows with errors as invalid', () => {
    const preview = buildPreview(
      'Title,SKU,Price\nGood,HOKK-X-005,100\n,HOKK-X-006,100',
      { name: 'Title', sku: 'SKU', price: 'Price' },
      'NEW',
    );
    expect(preview.summary.valid).toBe(1);
    expect(preview.summary.invalid).toBe(1);
  });
});

describe('duplicate detection', () => {
  const existingSku = 'HOKK-SAR-ZK-201';
  run(
    `INSERT INTO product (id, sku, name, name_status, status, category_id, handle, created_by_id, modified_by_id, created_at, updated_at)
     VALUES (?, ?, 'Existing Zari Kota', 'NAME_APPROVED', 'DRAFT', ?, 'existing-zari-kota', ?, ?, datetime('now'), datetime('now'))`,
    [cuid(), existingSku, sareeCategoryId, adminId, adminId],
  );

  it('flags a SKU that already exists in NEW mode', () => {
    const preview = buildPreview(
      `Title,SKU\nCopy,${existingSku}`,
      { name: 'Title', sku: 'SKU' },
      'NEW',
    );
    expect(preview.rows[0].duplicate?.type).toBe('SKU');
    expect(preview.summary.duplicates).toBe(1);
    expect(preview.rows[0].issues.some((issue) => issue.code === 'DUPLICATE')).toBe(true);
  });

  it('flags a duplicate handle', () => {
    const preview = buildPreview('Title,SKU,Handle\nNew Name,HOKK-SAR-ZK-299,existing-zari-kota', { name: 'Title', sku: 'SKU', handle: 'Handle' }, 'NEW');
    expect(preview.rows[0].duplicate?.type).toBe('HANDLE');
  });

  it('flags an exact name match', () => {
    const preview = buildPreview('Title,SKU\nExisting Zari Kota,HOKK-SAR-ZK-300', { name: 'Title', sku: 'SKU' }, 'NEW');
    expect(preview.rows[0].duplicate?.type).toBe('NAME');
  });

  it('flags a similar name as a potential duplicate', () => {
    const preview = buildPreview('Title,SKU\nExisting Zari Kota Saree,HOKK-SAR-ZK-301', { name: 'Title', sku: 'SKU' }, 'NEW');
    expect(preview.rows[0].duplicate?.type).toBe('SIMILAR_NAME');
  });

  it('flags the same SKU appearing twice within one file', () => {
    const preview = buildPreview(
      'Title,SKU\nFirst,HOKK-SAR-ZK-400\nSecond,HOKK-SAR-ZK-400',
      { name: 'Title', sku: 'SKU' },
      'NEW',
    );
    const second = preview.rows[1];
    expect(second.issues.some((issue) => issue.code === 'DUPLICATE_IN_FILE')).toBe(true);
  });
});

describe('UPDATE mode', () => {
  it('matches an existing product by SKU', () => {
    const preview = buildPreview(
      'Title,SKU,Price\nUpdated Name,HOKK-SAR-ZK-201,15000',
      { name: 'Title', sku: 'SKU', price: 'Price' },
      'UPDATE',
    );
    expect(preview.rows[0].existingProductId).toBeTruthy();
    expect(preview.summary.updates).toBe(1);
  });

  it('errors when nothing matches, rather than silently creating', () => {
    const preview = buildPreview('Title,SKU\nStray,HOKK-SAR-ZK-999', { name: 'Title', sku: 'SKU' }, 'UPDATE');
    expect(preview.rows[0].existingProductId).toBeNull();
    expect(preview.rows[0].issues.some((issue) => issue.code === 'NO_MATCH')).toBe(true);
  });
});

describe('applyImport', () => {
  it('creates products in NEW mode and records the run', () => {
    const csv = [
      'Title,SKU,Category,Price,Colour,Collections',
      'Imported Saree One,HOKK-SAR-ZK-501,Sarees,11000,Maroon,Festive Edit',
      'Imported Saree Two,HOKK-SAR-ZK-502,Sarees,12000,Indigo,',
    ].join('\n');
    const collectionId = cuid();
    run(
      `INSERT INTO collection (id, name, slug, handle, kind, sort_order, created_at, updated_at)
       VALUES (?, 'Festive Edit', 'festive-edit', 'festive-edit', 'CUSTOMER', 1, datetime('now'), datetime('now'))`,
      [collectionId],
    );

    const result = applyImport(
      csv,
      { name: 'Title', sku: 'SKU', category: 'Category', price: 'Price', colour: 'Colour', collections: 'Collections' },
      'NEW',
      adminId,
      true,
    );

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);

    const created = get<{ id: string; sku: string; price: number; colour: string; category_id: string }>(
      'SELECT id, sku, price, colour, category_id FROM product WHERE sku = ?',
      ['HOKK-SAR-ZK-501'],
    );
    expect(created).toBeTruthy();
    expect(created!.price).toBe(11000);
    expect(created!.colour).toBe('Maroon');
    expect(created!.category_id).toBe(sareeCategoryId);

    // The collection name resolved to a link row.
    const link = get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM product_collection WHERE product_id = ? AND collection_id = ?',
      [created!.id, collectionId],
    );
    expect(link!.n).toBe(1);

    const runRow = get<{ status: string; imported_count: number }>('SELECT status, imported_count FROM import_run WHERE id = ?', [
      result.importId,
    ]);
    expect(runRow!.status).toBe('COMPLETED');
    expect(runRow!.imported_count).toBe(2);
  });

  it('skips rows with errors and records why', () => {
    const csv = ['Title,SKU,Price\nGood Row,HOKK-SAR-ZK-601,100\n,HOKK-SAR-ZK-602,100'].join('\n');
    const result = applyImport(csv, { name: 'Title', sku: 'SKU', price: 'Price' }, 'NEW', adminId, true);
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);

    const failed = all<{ status: string; issues: string }>(
      'SELECT status, issues FROM import_row WHERE import_id = ? AND status = ?',
      [result.importId, 'FAILED'],
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].issues).toContain('MISSING_NAME');
  });

  it('skips flagged duplicates when asked to', () => {
    const csv = 'Title,SKU\nExisting Zari Kota,HOKK-SAR-ZK-201';
    const result = applyImport(csv, { name: 'Title', sku: 'SKU' }, 'NEW', adminId, true);
    expect(result.imported).toBe(0);
    expect(result.duplicates).toBe(1);
  });

  it('updates an existing product in UPDATE mode instead of duplicating it', () => {
    const csv = 'Title,SKU,Price,Colour\nRenamed By Import,HOKK-SAR-ZK-201,16500,Teal';
    const result = applyImport(
      csv,
      { name: 'Title', sku: 'SKU', price: 'Price', colour: 'Colour' },
      'UPDATE',
      adminId,
      true,
    );
    expect(result.imported).toBe(1);

    const row = get<{ price: number; colour: string }>(
      'SELECT price, colour FROM product WHERE sku = ?',
      ['HOKK-SAR-ZK-201'],
    );
    expect(row!.price).toBe(16500);
    expect(row!.colour).toBe('Teal');
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM product WHERE sku = ?', ['HOKK-SAR-ZK-201'])!.n).toBe(1);
  });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
