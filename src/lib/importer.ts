import 'server-only';
import { all, get, json, parseJson, run, transaction } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { parseCsv } from '@/lib/csv';
import { slugify } from '@/lib/handle';
import { createProduct } from '@/lib/products';
import { logAudit } from '@/lib/audit';
import type { ExportMode, Issue, ProductRow } from '@/lib/types';

/**
 * Column detection + mapping + validation + import (spec §36).
 *
 * A blind import is never allowed: the file is parsed, columns are detected,
 * mapped, previewed and validated, duplicates are flagged, and only then are
 * rows written.
 */

export interface ImportTarget {
  key: string;
  label: string;
  required?: boolean;
}

/** Internal fields a CSV column may be mapped to. */
export const IMPORT_TARGETS: ImportTarget[] = [
  { key: 'name', label: 'Product name' },
  { key: 'sku', label: 'SKU' },
  { key: 'handle', label: 'Handle' },
  { key: 'short_description', label: 'Short description' },
  { key: 'full_description', label: 'Full description' },
  { key: 'story', label: 'The story' },
  { key: 'about_the_weave', label: 'About the weave' },
  { key: 'about_the_artisan', label: 'About the artisan' },
  { key: 'care', label: 'Care instructions' },
  { key: 'details', label: 'Details' },
  { key: 'shipping_notes', label: 'Shipping notes' },
  { key: 'category', label: 'Category (name)' },
  { key: 'culture', label: 'Handloom culture (name)' },
  { key: 'collections', label: 'Collections (comma separated)' },
  { key: 'colour', label: 'Colour' },
  { key: 'fabric', label: 'Fabric' },
  { key: 'region', label: 'Region' },
  { key: 'price', label: 'Price' },
  { key: 'compare_at_price', label: 'Compare-at price' },
  { key: 'cost_price', label: 'Cost price' },
  { key: 'currency', label: 'Currency' },
  { key: 'weight', label: 'Weight' },
  { key: 'inventory_qty', label: 'Inventory quantity' },
  { key: 'seo_title', label: 'SEO title' },
  { key: 'seo_description', label: 'SEO description' },
  { key: 'tags', label: 'Tags' },
  { key: 'image_url', label: 'Image URL' },
  { key: 'image_alt', label: 'Image alt text' },
  { key: 'option1_name', label: 'Option 1 name' },
  { key: 'option1_value', label: 'Option 1 value' },
  { key: 'variant_sku', label: 'Variant SKU' },
];

const NUMBER_KEYS = new Set(['price', 'compare_at_price', 'cost_price', 'weight', 'inventory_qty']);

/**
 * Guesses a mapping from Shopify and common spreadsheet headers so the operator
 * starts from a sensible default instead of a blank form.
 */
export function detectMapping(columns: string[]): Record<string, string> {
  const aliases: Record<string, string[]> = {
    name: ['title', 'product name', 'name'],
    sku: ['sku', 'variant sku', 'product sku'],
    handle: ['url handle', 'handle', 'permalink'],
    short_description: ['short description', 'subtitle'],
    full_description: ['description', 'body (html)', 'body html', 'full description'],
    story: ['the story', 'story', 'product story'],
    about_the_weave: ['about the weave', 'weave story'],
    about_the_artisan: ['about the artisan', 'artisan story'],
    care: ['care', 'care instructions'],
    details: ['details', 'product details'],
    shipping_notes: ['shipping', 'shipping notes', 'shipping / packaging'],
    category: ['product category', 'product type', 'type', 'category'],
    culture: ['handloom culture', 'culture', 'weave'],
    collections: ['collection', 'collections', 'tags'],
    colour: ['color (product.metafields.shopify.color-pattern)', 'colour', 'color', 'color swatch'],
    fabric: ['fabric', 'material'],
    region: ['region', 'state', 'origin'],
    price: ['price', 'variant price'],
    compare_at_price: ['compare-at price', 'compare at price', 'msrp'],
    cost_price: ['cost per item', 'cost price', 'cost'],
    currency: ['currency'],
    weight: ['weight value (grams)', 'weight'],
    inventory_qty: ['inventory quantity', 'variant inventory qty', 'quantity'],
    seo_title: ['seo title'],
    seo_description: ['seo description', 'meta description'],
    tags: ['tags'],
    image_url: ['product image url', 'image src', 'image url'],
    image_alt: ['image alt text', 'alt text'],
    option1_name: ['option1 name'],
    option1_value: ['option1 value'],
    variant_sku: ['variant sku'],
  };

  const mapping: Record<string, string> = {};
  for (const column of columns) {
    const normalised = column.trim().toLowerCase();
    for (const [target, names] of Object.entries(aliases)) {
      if (mapping[target]) continue;
      if (names.includes(normalised)) {
        mapping[target] = column;
        break;
      }
    }
  }
  return mapping;
}

export interface ImportRowAssessment {
  rowNumber: number;
  raw: Record<string, string>;
  mapped: Record<string, string | number | null>;
  issues: Issue[];
  duplicate: { type: string; message: string; productId: string | null } | null;
  existingProductId: string | null;
}

export interface ImportPreview {
  columns: string[];
  mapping: Record<string, string>;
  rows: ImportRowAssessment[];
  summary: { total: number; valid: number; invalid: number; duplicates: number; newProducts: number; updates: number };
  missingRequired: string[];
}

function similarNames(a: string, b: string): boolean {
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xWords = new Set(x.split(' '));
  const yWords = y.split(' ');
  const shared = yWords.filter((word) => xWords.has(word)).length;
  return shared >= Math.max(2, Math.floor(Math.min(xWords.size, yWords.length) * 0.8));
}

export function buildPreview(
  text: string,
  mapping: Record<string, string>,
  mode: ExportMode,
): ImportPreview {
  const parsed = parseCsv(text);
  const bySku = new Map(all<ProductRow>('SELECT * FROM product').map((product) => [product.sku.toUpperCase(), product]));
  const byHandle = new Map(
    all<ProductRow>('SELECT * FROM product WHERE handle IS NOT NULL').map((product) => [String(product.handle).toLowerCase(), product]),
  );
  const names = all<{ id: string; sku: string; name: string }>('SELECT id, sku, name FROM product WHERE name IS NOT NULL');

  const rows: ImportRowAssessment[] = [];
  parsed.rows.forEach((raw, index) => {
    const rowNumber = index + 2; // header is row 1
    const issues: Issue[] = [];
    const mapped: Record<string, string | number | null> = {};

    for (const [target, column] of Object.entries(mapping)) {
      const value = (raw[column] ?? '').trim();
      if (NUMBER_KEYS.has(target)) {
        if (value === '') {
          mapped[target] = null;
          continue;
        }
        const num = Number(value.replace(/[^\d.\-]/g, ''));
        if (Number.isNaN(num)) {
          issues.push({ code: 'INVALID_NUMBER', message: `“${column}” is not a number.`, severity: 'ERROR' });
          mapped[target] = null;
        } else if (num < 0) {
          issues.push({ code: 'NEGATIVE_VALUE', message: `${target} cannot be negative.`, severity: 'ERROR' });
          mapped[target] = num;
        } else {
          mapped[target] = num;
        }
        continue;
      }
      mapped[target] = value === '' ? null : value;
    }

    // Required field checks.
    const name = typeof mapped.name === 'string' ? mapped.name : null;
    if (!name) issues.push({ code: 'MISSING_NAME', message: 'No product name mapped for this row.', severity: 'ERROR' });

    const sku = typeof mapped.sku === 'string' ? mapped.sku.toUpperCase() : null;
    const handle = typeof mapped.handle === 'string' ? mapped.handle.toLowerCase() : null;

    // Category must exist.
    const categoryName = typeof mapped.category === 'string' ? mapped.category : null;
    let categoryId: string | null = null;
    if (categoryName) {
      const category = get<{ id: string }>(
        'SELECT id FROM category WHERE lower(name) = lower(?) OR lower(handle) = lower(?)',
        [categoryName, slugify(categoryName)],
      );
      if (category) categoryId = category.id;
      else issues.push({ code: 'UNKNOWN_CATEGORY', message: `Category “${categoryName}” does not exist. Create it first.`, severity: 'ERROR' });
    }

    const cultureName = typeof mapped.culture === 'string' ? mapped.culture : null;
    let cultureId: string | null = null;
    if (cultureName) {
      const culture = get<{ id: string }>(
        'SELECT id FROM handloom_culture WHERE lower(name) = lower(?) OR lower(code) = lower(?)',
        [cultureName, cultureName.toUpperCase()],
      );
      if (culture) cultureId = culture.id;
      else issues.push({ code: 'UNKNOWN_CULTURE', message: `Handloom culture “${cultureName}” does not exist.`, severity: 'ERROR' });
    }

    mapped.category_id = categoryId;
    mapped.handloom_culture_id = cultureId;

    // Duplicate detection: SKU, handle, exact name, similar name.
    let duplicate: ImportRowAssessment['duplicate'] = null;
    let existingProductId: string | null = null;

    const skuMatch = sku ? bySku.get(sku) : undefined;
    const handleMatch = handle ? byHandle.get(handle) : undefined;
    const nameMatch = name ? names.find((entry) => entry.name.toLowerCase() === name.toLowerCase()) : undefined;
    const similarMatch = name ? names.find((entry) => similarNames(entry.name, name)) : undefined;

    if (mode === 'NEW') {
      if (skuMatch) duplicate = { type: 'SKU', message: `SKU ${skuMatch.sku} already exists.`, productId: skuMatch.id };
      else if (handleMatch) duplicate = { type: 'HANDLE', message: `Handle ${handleMatch.handle} already exists.`, productId: handleMatch.id };
      else if (nameMatch) duplicate = { type: 'NAME', message: `A product named “${nameMatch.name}” already exists.`, productId: nameMatch.id };
      else if (similarMatch)
        duplicate = {
          type: 'SIMILAR_NAME',
          message: `Possible duplicate of “${similarMatch.name}” (${similarMatch.sku}).`,
          productId: similarMatch.id,
        };
    } else {
      existingProductId = skuMatch?.id ?? handleMatch?.id ?? null;
      if (!existingProductId) {
        issues.push({ code: 'NO_MATCH', message: 'No existing product matches this SKU or handle — nothing to update.', severity: 'ERROR' });
      }
    }

    if (duplicate) {
      issues.push({ code: 'DUPLICATE', message: duplicate.message, severity: 'WARNING' });
    }

    // Cross-row duplicates within the same file.
    if (sku) {
      const earlier = rows.find((row) => row.mapped.sku === sku);
      if (earlier) issues.push({ code: 'DUPLICATE_IN_FILE', message: `SKU ${sku} appears more than once in this file.`, severity: 'ERROR' });
    }

    rows.push({ rowNumber, raw, mapped, issues, duplicate, existingProductId });
  });

  const valid = rows.filter((row) => !row.issues.some((issue) => issue.severity === 'ERROR'));
  const missingRequired = IMPORT_TARGETS.filter((target) => target.required && !mapping[target.key]).map((target) => target.label);

  return {
    columns: parsed.columns,
    mapping,
    rows,
    summary: {
      total: rows.length,
      valid: valid.length,
      invalid: rows.length - valid.length,
      duplicates: rows.filter((row) => row.duplicate).length,
      newProducts: rows.filter((row) => !row.existingProductId && !row.issues.some((i) => i.severity === 'ERROR')).length,
      updates: rows.filter((row) => row.existingProductId).length,
    },
    missingRequired,
  };
}

export interface ImportResult {
  importId: string;
  imported: number;
  skipped: number;
  failed: number;
  duplicates: number;
}

const UPDATABLE_COLUMNS = new Set([
  'name',
  'handle',
  'short_description',
  'full_description',
  'story',
  'about_the_weave',
  'about_the_artisan',
  'care',
  'details',
  'shipping_notes',
  'category_id',
  'handloom_culture_id',
  'colour',
  'fabric',
  'region',
  'price',
  'compare_at_price',
  'cost_price',
  'currency',
  'weight',
  'inventory_qty',
  'seo_title',
  'seo_description',
]);

export function applyImport(
  text: string,
  mapping: Record<string, string>,
  mode: ExportMode,
  userId: string,
  skipDuplicates: boolean,
): ImportResult {
  const preview = buildPreview(text, mapping, mode);
  const importId = cuid();
  const stamp = nowIso();

  run(
    `INSERT INTO import_run
      (id, file_name, status, row_count, column_mapping, detected_columns, header_row, user_id, created_at, updated_at)
     VALUES (?, ?, 'RUNNING', ?, ?, ?, 1, ?, ?, ?)`,
    [importId, 'upload', preview.rows.length, json(mapping), json(preview.columns), userId, stamp, stamp],
  );

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const duplicates = preview.summary.duplicates;

  for (const row of preview.rows) {
    const errors = row.issues.filter((issue) => issue.severity === 'ERROR');
    if (errors.length > 0 || (skipDuplicates && row.duplicate)) {
      skipped += 1;
      run(
        `INSERT INTO import_row (id, import_id, row_number, raw_data, mapped_data, status, issues, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [cuid(), importId, row.rowNumber, json(row.raw), json(row.mapped), errors.length > 0 ? 'FAILED' : 'SKIPPED', json(row.issues), stamp],
      );
      if (errors.length > 0) failed += 1;
      continue;
    }

    try {
      transaction(() => {
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row.mapped)) {
          if (!UPDATABLE_COLUMNS.has(key)) continue;
          if (value === null || value === '') continue;
          patch[key] = value;
        }

        let productId: string;
        if (row.existingProductId) {
          productId = row.existingProductId;
          const columns = Object.keys(patch).filter((column) => column !== 'name' || patch.name);
          if (columns.length > 0) {
            const assignments = columns.map((column) => `"${column}" = ?`).join(', ');
            run(`UPDATE product SET ${assignments}, updated_at = ? WHERE id = ?`, [
              ...columns.map((column) => patch[column]),
              stamp,
              productId,
            ]);
          }
        } else {
          const sku = typeof row.mapped.sku === 'string' && row.mapped.sku ? String(row.mapped.sku) : undefined;
          const created = createProduct(
            {
              name: typeof row.mapped.name === 'string' ? row.mapped.name : undefined,
              sku,
              categoryId: typeof row.mapped.category_id === 'string' ? row.mapped.category_id : null,
              handloomCultureId: typeof row.mapped.handloom_culture_id === 'string' ? row.mapped.handloom_culture_id : null,
              price: typeof row.mapped.price === 'number' ? row.mapped.price : null,
            },
            userId,
          );
          productId = created.id;

          // createProduct owns SKU allocation, audit and recomputation; the
          // remaining mapped columns are written afterwards.
          const extraColumns = Object.keys(patch).filter(
            (column) => !['name', 'category_id', 'handloom_culture_id', 'price'].includes(column),
          );
          if (extraColumns.length > 0) {
            const extraAssignments = extraColumns.map((column) => `"${column}" = ?`).join(', ');
            run(`UPDATE product SET ${extraAssignments}, updated_at = ? WHERE id = ?`, [
              ...extraColumns.map((column) => patch[column]),
              stamp,
              productId,
            ]);
          }
        }

        // Collections
        const collectionList = typeof row.mapped.collections === 'string' ? row.mapped.collections : '';
        if (collectionList) {
          for (const name of collectionList.split(/[,|;]/).map((value) => value.trim()).filter(Boolean)) {
            const collection = get<{ id: string }>('SELECT id FROM collection WHERE lower(name) = lower(?)', [name]);
            if (!collection) continue;
            const existing = get<{ id: string }>('SELECT id FROM product_collection WHERE product_id = ? AND collection_id = ?', [
              productId,
              collection.id,
            ]);
            if (!existing) {
              run('INSERT INTO product_collection (id, product_id, collection_id, created_at) VALUES (?, ?, ?, ?)', [
                cuid(),
                productId,
                collection.id,
                stamp,
              ]);
            }
          }
        }

        // Tags
        const tagList = typeof row.mapped.tags === 'string' ? row.mapped.tags : '';
        if (tagList) {
          run('UPDATE product SET tags = ? WHERE id = ?', [json(tagList.split(',').map((tag) => tag.trim()).filter(Boolean)), productId]);
        }

        // Details
        const details = typeof row.mapped.details === 'string' ? row.mapped.details : '';
        if (details) {
          run('UPDATE product SET details = ? WHERE id = ?', [
            json(details.split(/[\n;]/).map((line) => line.trim()).filter(Boolean)),
            productId,
          ]);
        }

        run(
          `INSERT INTO import_row (id, import_id, row_number, raw_data, mapped_data, status, issues, product_id, created_at)
           VALUES (?, ?, ?, ?, ?, 'IMPORTED', '[]', ?, ?)`,
          [cuid(), importId, row.rowNumber, json(row.raw), json(row.mapped), productId, stamp],
        );
      });
      imported += 1;
    } catch (error) {
      failed += 1;
      run(
        `INSERT INTO import_row (id, import_id, row_number, raw_data, mapped_data, status, issues, created_at)
         VALUES (?, ?, ?, ?, ?, 'FAILED', ?, ?)`,
        [
          cuid(),
          importId,
          row.rowNumber,
          json(row.raw),
          json(row.mapped),
          json([{ code: 'IMPORT_ERROR', message: (error as Error).message, severity: 'ERROR' }]),
          stamp,
        ],
      );
    }
  }

  run(
    `UPDATE import_run SET status = 'COMPLETED', imported_count = ?, skipped_count = ?, failed_count = ?, duplicate_count = ?, updated_at = ? WHERE id = ?`,
    [imported, skipped, failed, duplicates, nowIso(), importId],
  );

  logAudit({
    entityType: 'IMPORT',
    entityId: importId,
    entityLabel: 'CSV import',
    action: 'IMPORT',
    userId,
    changes: [
      { field: 'mode', label: 'Mode', oldValue: null, newValue: mode },
      { field: 'imported', label: 'Imported', oldValue: null, newValue: imported },
      { field: 'skipped', label: 'Skipped', oldValue: null, newValue: skipped },
    ],
  });

  return { importId, imported, skipped, failed, duplicates };
}

export function listImports(limit = 20) {
  return all<{
    id: string;
    file_name: string;
    status: string;
    row_count: number;
    imported_count: number;
    skipped_count: number;
    failed_count: number;
    duplicate_count: number;
    created_at: string;
    user_name: string | null;
  }>(
    `SELECT i.*, u.name AS user_name FROM import_run i LEFT JOIN "user" u ON u.id = i.user_id ORDER BY i.created_at DESC LIMIT ?`,
    [limit],
  );
}

export function listImportRows(importId: string, status?: string) {
  const where = status ? 'AND status = ?' : '';
  const params = status ? [importId, status] : [importId];
  return all<{ id: string; row_number: number; raw_data: string; mapped_data: string; status: string; issues: string; product_id: string | null }>(
    `SELECT * FROM import_row WHERE import_id = ? ${where} ORDER BY row_number LIMIT 500`,
    params,
  );
}

