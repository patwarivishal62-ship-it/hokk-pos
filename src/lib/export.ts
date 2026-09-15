import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, json, parseJson, run, transaction } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { getBoolean, getSetting } from '@/lib/settings';
import { bundleFor, getProduct } from '@/lib/products';
import { assessReadiness } from '@/lib/readiness';
import { findPreset } from '@/lib/shopify/schema';
import { buildCatalogCsv, type ExportProductInput, type MappedColumn } from '@/lib/shopify/build';
import { toCsv } from '@/lib/csv';
import { resolvePublicUrl } from '@/lib/storage';
import { logAudit } from '@/lib/audit';
import type { ExportMode, Issue, ProductRow, ReadinessState } from '@/lib/types';

export interface ExportOptions {
  mode: ExportMode;
  productIds?: string[];
  includeImages: boolean;
  includeCollectionColumn: boolean;
  /** Admin override: include products that only have warnings. */
  includeWarnings: boolean;
}

export interface ExportProductAssessment {
  product: ProductRow;
  state: ReadinessState;
  issues: Issue[];
}

export interface ExportSummary {
  total: number;
  ready: number;
  warnings: number;
  blocked: number;
  included: number;
  imageWarnings: string[];
}

function loadMappings(): { columns: MappedColumn[]; version: string; key: string } {
  const schemaKey = getSetting('shopify.schema_key') || 'shopify-product-csv';
  const preset = findPreset(schemaKey);
  const rows = all<{ schema_key: string; column: string; level: string; enabled: number; sort_order: number }>(
    'SELECT schema_key, column, level, enabled, sort_order FROM shopify_field_mapping ORDER BY sort_order',
  );
  const columns: MappedColumn[] =
    rows.length > 0
      ? rows.map((row) => ({
          key: row.schema_key,
          column: row.column,
          level: row.level as MappedColumn['level'],
          enabled: row.enabled === 1,
        }))
      : preset.columns
          .filter((column) => column.enabled)
          .map((column) => ({ key: column.key, column: column.column, level: column.level, enabled: true }));
  return { columns, version: getSetting('shopify.schema_version') || preset.version, key: schemaKey };
}

function selectProducts(options: ExportOptions): ProductRow[] {
  if (options.productIds && options.productIds.length > 0) {
    const placeholders = options.productIds.map(() => '?').join(',');
    return all<ProductRow>(
      `SELECT p.*, COALESCE(c.template_key,'GENERIC') AS template_key, c.name AS category_name,
              c.shopify_category, c.shopify_type, hc.name AS culture_name
       FROM product p
       LEFT JOIN category c ON c.id = p.category_id
       LEFT JOIN handloom_culture hc ON hc.id = p.handloom_culture_id
       WHERE p.id IN (${placeholders}) AND p.is_archived = 0`,
      options.productIds,
    );
  }
  const where: string[] = ['p.is_archived = 0'];
  if (options.mode === 'NEW') where.push("p.shopify_product_id IS NULL AND p.status NOT IN ('EXPORTED','PUBLISHED')");
  if (options.mode === 'UPDATE') where.push("(p.shopify_product_id IS NOT NULL OR p.status IN ('EXPORTED','PUBLISHED'))");
  return all<ProductRow>(
    `SELECT p.*, COALESCE(c.template_key,'GENERIC') AS template_key, c.name AS category_name,
            c.shopify_category, c.shopify_type, hc.name AS culture_name
     FROM product p
     LEFT JOIN category c ON c.id = p.category_id
     LEFT JOIN handloom_culture hc ON hc.id = p.handloom_culture_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.sku`,
  );
}

/**
 * Assesses every candidate product. Duplicate handles/SKUs are detected across
 * the whole selection, not just against the database, so two products in the
 * same export cannot both claim the same handle.
 */
export function assessSelection(options: ExportOptions): {
  assessments: ExportProductAssessment[];
  summary: ExportSummary;
} {
  const products = selectProducts(options);
  const handleCounts = new Map<string, number>();
  const skuCounts = new Map<string, number>();
  for (const product of products) {
    if (product.handle) {
      const key = product.handle.toLowerCase();
      handleCounts.set(key, (handleCounts.get(key) ?? 0) + 1);
    }
    const skuKey = product.sku.toUpperCase();
    skuCounts.set(skuKey, (skuCounts.get(skuKey) ?? 0) + 1);
  }

  const assessments: ExportProductAssessment[] = products.map((product) => {
    const bundle = bundleFor(product);
    if (!bundle) return { product, state: 'BLOCKED' as ReadinessState, issues: [{ code: 'NOT_FOUND', message: 'Product could not be loaded.', severity: 'ERROR' as const }] };

    const duplicateHandles = new Set(
      [...handleCounts.entries()].filter(([, count]) => count > 1).map(([handle]) => handle),
    );
    const duplicateSkus = new Set(
      [...skuCounts.entries()].filter(([, count]) => count > 1).map(([sku]) => sku),
    );

    const imagesPublic = bundle.images.every((image) =>
      Boolean(
        resolvePublicUrl({
          storageBackend: image.storage_backend,
          storageKey: image.storage_key,
          driveFileId: image.drive_file_id,
          publicUrl: image.public_url,
        }),
      ),
    );

    const readiness = assessReadiness(bundle, {
      usedHandles: duplicateHandles,
      usedSkus: duplicateSkus,
      imagesPubliclyAccessible: bundle.images.length > 0 ? imagesPublic : undefined,
    });
    return { product, state: readiness.state, issues: readiness.issues };
  });

  const summary: ExportSummary = {
    total: assessments.length,
    ready: assessments.filter((a) => a.state === 'READY').length,
    warnings: assessments.filter((a) => a.state === 'WARNINGS').length,
    blocked: assessments.filter((a) => a.state === 'BLOCKED').length,
    included: assessments.filter((a) => a.state === 'READY' || (options.includeWarnings && a.state === 'WARNINGS')).length,
    imageWarnings: [],
  };
  return { assessments, summary };
}

function toExportInput(assessment: ExportProductAssessment): ExportProductInput {
  const bundle = bundleFor(assessment.product);
  if (!bundle) throw new Error(`Product ${assessment.product.sku} could not be loaded.`);
  return {
    product: assessment.product,
    variants: bundle.variants.filter((variant) => variant.is_active === 1),
    images: bundle.images.map((image) => ({
      id: image.id,
      sortOrder: image.sort_order,
      altText: image.alt_text,
      isPrimary: image.is_primary,
      slotKey: image.slot_key ?? null,
      publicUrl: resolvePublicUrl({
        storageBackend: image.storage_backend,
        storageKey: image.storage_key,
        driveFileId: image.drive_file_id,
        publicUrl: image.public_url,
      }),
    })),
    collections: bundle.collections.map((collection) => collection.name),
    category: assessment.product.category_id
      ? {
          name: assessment.product.category_name ?? '',
          shopify_category:
            (assessment.product as unknown as { shopify_category?: string | null }).shopify_category ?? null,
          shopify_type: (assessment.product as unknown as { shopify_type?: string | null }).shopify_type ?? null,
        }
      : null,
    culture: assessment.product.culture_name ? { name: assessment.product.culture_name } : null,
  };
}

export interface ExportResult {
  exportId: string;
  number: number;
  fileName: string;
  filePath: string;
  bytes: number;
  counts: { total: number; included: number; ready: number; warnings: number; blocked: number };
  warnings: string[];
  blocked: Array<{ sku: string; issues: Issue[] }>;
}

export function runExport(options: ExportOptions, userId: string): ExportResult {
  const { assessments, summary } = assessSelection(options);
  const included = assessments.filter(
    (assessment) => assessment.state === 'READY' || (options.includeWarnings && assessment.state === 'WARNINGS'),
  );
  const blocked = assessments
    .filter((assessment) => assessment.state === 'BLOCKED')
    .map((assessment) => ({ sku: assessment.product.sku, issues: assessment.issues.filter((i) => i.severity === 'ERROR') }));

  if (included.length === 0) {
    throw new Error('Nothing to export: no products passed validation.');
  }

  const { columns, version, key } = loadMappings();
  const built = buildCatalogCsv(included.map(toExportInput), {
    columns,
    vendor: getSetting('shopify.vendor'),
    defaultStatus: (getSetting('shopify.default_status') || 'draft') as 'active' | 'draft' | 'archived',
    published: getBoolean('shopify.published', false),
    includeImages: options.includeImages,
    includeCollectionColumn: options.includeCollectionColumn && getBoolean('shopify.collection_column', true),
  });

  const csv = toCsv(built.columns, built.rows, { bom: false });
  const stamp = nowIso();
  const number = (get<{ n: number }>('SELECT COALESCE(MAX(number),0) + 1 AS n FROM export_run')?.n ?? 1);
  const fileName = `hokk-shopify-${options.mode.toLowerCase()}-${stamp.slice(0, 10)}-${String(number).padStart(4, '0')}.csv`;
  const dir = (() => {
    if (process.env.EXPORT_DIR) return path.resolve(process.env.EXPORT_DIR);
    if (process.env.VERCEL) return '/tmp/storage/exports';
    return path.resolve(process.cwd(), 'storage/exports');
  })();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, csv, 'utf8');
  const bytes = Buffer.byteLength(csv, 'utf8');

  const publicBase = getSetting('storage.public_base_url') || process.env.PUBLIC_BASE_URL || '';
  const exportId = cuid();

  transaction(() => {
    run(
      `INSERT INTO export_run
         (id, number, mode, status, product_count, ready_count, warning_count, blocked_count, error_count,
          file_name, file_path, bytes, schema_version, schema_key, summary, include_images, public_base_url,
          user_id, created_at)
       VALUES (?, ?, ?, 'GENERATED', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exportId,
        number,
        options.mode,
        included.length,
        summary.ready,
        summary.warnings,
        summary.blocked,
        fileName,
        filePath,
        bytes,
        version,
        key,
        json({
          selected: summary.total,
          included: included.length,
          ready: summary.ready,
          warnings: summary.warnings,
          blocked: summary.blocked,
          includeWarnings: options.includeWarnings,
          csvWarnings: built.warnings,
          blockedSkus: blocked.map((entry) => entry.sku),
        }),
        options.includeImages ? 1 : 0,
        publicBase,
        userId,
        stamp,
      ],
    );

    assessments.forEach((assessment, index) => {
      if (assessment.state === 'BLOCKED' && !options.includeWarnings) {
        // still recorded so the preview matches history
      }
      run(
        `INSERT INTO export_run_product (id, export_id, product_id, sku, state, issues, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [cuid(), exportId, assessment.product.id, assessment.product.sku, assessment.state, json(assessment.issues), index],
      );
    });

    for (const assessment of included) {
      run('UPDATE product SET last_exported_at = ?, last_export_run_id = ? WHERE id = ?', [stamp, exportId, assessment.product.id]);
      if (assessment.product.status === 'SHOPIFY_READY') {
        run('UPDATE product SET status = ? WHERE id = ?', ['EXPORTED', assessment.product.id]);
      }
    }

    logAudit({
      entityType: 'EXPORT',
      entityId: exportId,
      entityLabel: fileName,
      action: 'EXPORT',
      userId,
      changes: [
        { field: 'products', label: 'Products exported', oldValue: null, newValue: included.length },
        { field: 'mode', label: 'Mode', oldValue: null, newValue: options.mode },
      ],
      meta: { blocked: blocked.length, warnings: summary.warnings },
    });
  });

  const allWarnings = [
    ...built.warnings,
    ...(publicBase ? [] : ['No public base URL is configured — local image paths cannot be read by Shopify.']),
    ...(options.includeWarnings ? ['Warning-level products were included by administrator override.'] : []),
  ];

  return {
    exportId,
    number,
    fileName,
    filePath,
    bytes,
    counts: {
      total: summary.total,
      included: included.length,
      ready: summary.ready,
      warnings: summary.warnings,
      blocked: summary.blocked,
    },
    warnings: [...new Set(allWarnings)],
    blocked,
  };
}

export function getExport(exportId: string) {
  const row = get<Record<string, unknown>>('SELECT * FROM export_run WHERE id = ?', [exportId]);
  if (!row) return null;
  const items = all<{ sku: string; state: string; issues: string; product_id: string }>(
    'SELECT sku, state, issues, product_id FROM export_run_product WHERE export_id = ? ORDER BY sort_order',
    [exportId],
  );
  return { run: row, items };
}

export function listExports(limit = 50) {
  return all<{
    id: string;
    number: number;
    mode: string;
    status: string;
    product_count: number;
    ready_count: number;
    warning_count: number;
    blocked_count: number;
    file_name: string | null;
    bytes: number | null;
    schema_version: string;
    created_at: string;
    user_name: string | null;
  }>(
    `SELECT e.*, u.name AS user_name FROM export_run e
     LEFT JOIN "user" u ON u.id = e.user_id ORDER BY e.created_at DESC LIMIT ?`,
    [limit],
  );
}

export function readExportFile(filePath: string): Buffer | null {
  const resolved = path.resolve(filePath);
  const allowedDirs = [
    path.resolve(process.cwd(), 'storage/exports'),
    '/tmp/storage/exports',
    process.env.EXPORT_DIR ? path.resolve(process.env.EXPORT_DIR) : null,
  ].filter(Boolean) as string[];
  if (!allowedDirs.some((dir) => resolved.startsWith(dir))) return null;
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}

export function markExportStatus(exportId: string, status: string): void {
  run('UPDATE export_run SET status = ? WHERE id = ?', [status, exportId]);
}

export function productCollectionsForExport(productId: string): string[] {
  return parseJson<string[]>(
    json(
      all<{ name: string }>(
        `SELECT c.name FROM collection c JOIN product_collection pc ON pc.collection_id = c.id WHERE pc.product_id = ?`,
        [productId],
      ).map((row) => row.name),
    ),
    [],
  );
}

export function getProductForExport(productId: string): ProductRow | undefined {
  return getProduct(productId);
}
