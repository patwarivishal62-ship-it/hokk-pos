/**
 * Builds Shopify product CSV rows from HOKK product records.
 *
 * Row layout follows Shopify's own template:
 *   row 1        → product fields + first variant + first image
 *   rows 2..n    → remaining variants (handle only, product fields blank)
 *   rows n+1..   → remaining images (handle + image fields only)
 *
 * Column headers come from the mapping rows, never from literals, so the
 * output follows whatever schema the administrator has configured.
 */
import { parseJson } from '@/lib/db';
import type { ProductRow, VariantRow } from '@/lib/types';

export interface ExportImage {
  id: string;
  sortOrder: number;
  altText: string | null;
  isPrimary: number;
  slotKey: string | null;
  /** Resolved public URL, or null when the asset is not publicly reachable. */
  publicUrl: string | null;
}

export interface ExportProductInput {
  product: ProductRow;
  variants: VariantRow[];
  images: ExportImage[];
  collections: string[];
  category: { name: string; shopify_category: string | null; shopify_type: string | null } | null;
  culture: { name: string } | null;
}

export interface MappedColumn {
  key: string;
  column: string;
  level: 'PRODUCT' | 'VARIANT' | 'IMAGE';
  enabled: boolean;
}

export interface BuildOptions {
  columns: MappedColumn[];
  vendor: string;
  defaultStatus: 'active' | 'draft' | 'archived';
  published: boolean;
  includeImages: boolean;
  includeCollectionColumn: boolean;
  /** When true, product-level fields are emitted on every row (some tools expect this). */
  repeatProductFields?: boolean;
}

export interface BuiltCsv {
  columns: string[];
  rows: Record<string, unknown>[];
  warnings: string[];
}

const TRUE = 'TRUE';
const FALSE = 'FALSE';

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphs(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .split(/\n{2,}|\r\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

/** Composes the Shopify description from the separated content fields (spec §16). */
export function buildDescription(product: ProductRow): string {
  const parts: string[] = [];
  const full = product.full_description?.trim();
  if (full && /<[a-z][\s\S]*>/i.test(full)) {
    parts.push(full); // already HTML
  } else {
    parts.push(paragraphs(full || product.short_description));
  }
  if (product.story?.trim()) {
    parts.push('<h3>The Story</h3>', paragraphs(product.story));
  }
  if (product.about_the_weave?.trim()) {
    parts.push('<h3>About the Weave</h3>', paragraphs(product.about_the_weave));
  }
  if (product.about_the_artisan?.trim()) {
    parts.push('<h3>About the Artisan</h3>', paragraphs(product.about_the_artisan));
  }
  const details = parseJson<string[]>(product.details, []);
  const bullets = details.filter((d) => typeof d === 'string' && d.trim());
  if (bullets.length > 0) {
    parts.push('<h3>Details</h3>', '<ul>', ...bullets.map((b) => `<li>${escapeHtml(b.trim())}</li>`), '</ul>');
  }
  const care = product.care?.trim() || product.care_instructions?.trim();
  if (care) {
    parts.push('<h3>Care</h3>', paragraphs(care));
  }
  return parts.filter(Boolean).join('\n');
}

/** Converts any supported weight unit to grams (Shopify's Weight value column). */
export function toGrams(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  switch ((unit ?? 'g').toLowerCase()) {
    case 'kg':
      return Math.round(value * 1000);
    case 'oz':
      return Math.round(value * 28.3495);
    case 'lb':
    case 'lbs':
      return Math.round(value * 453.592);
    case 'g':
    default:
      return Math.round(value);
  }
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(2);
}

function statusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'active') return 'Active';
  if (normalized === 'archived') return 'Archived';
  return 'Draft';
}

function optionNamesEmitted(index: number): boolean {
  // Shopify's template writes option names on the first row only.
  return index === 0;
}

export function buildProductRows(input: ExportProductInput, options: BuildOptions): BuiltCsv {
  const { product } = input;
  const warnings: string[] = [];
  const enabled = options.columns.filter((column) => column.enabled);
  const byKey = new Map(enabled.map((column) => [column.key, column.column]));
  const has = (key: string) => byKey.has(key);

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const column of enabled) {
    if (seen.has(column.column)) continue;
    seen.add(column.column);
    columns.push(column.column);
  }
  if (options.includeCollectionColumn) {
    columns.push('Collection');
  }

  const variants = input.variants.length > 0 ? input.variants : [];
  const images = options.includeImages
    ? input.images.slice().sort((a, b) => (b.isPrimary - a.isPrimary) || a.sortOrder - b.sortOrder)
    : [];

  const imagePublicCount = images.filter((img) => !!img.publicUrl).length;
  if (images.length > 0 && imagePublicCount < images.length) {
    warnings.push(
      `${product.sku}: ${images.length - imagePublicCount} image(s) have no public URL and were written as blank — Shopify cannot fetch local files.`,
    );
  }

  const productFields = (): Record<string, unknown> => {
    const row: Record<string, unknown> = {};
    const set = (key: string, value: unknown) => {
      const column = byKey.get(key);
      if (column) row[column] = value;
    };
    set('title', product.name ?? '');
    set('url_handle', product.handle ?? '');
    set('description', buildDescription(product));
    set('vendor', product.vendor || options.vendor);
    set(
      'product_category',
      input.category?.shopify_category || product.template_suffix || '',
    );
    set('type', input.category?.shopify_type || product.product_type_label || input.category?.name || '');
    const tags = parseJson<string[]>(product.tags, []);
    const allTags = [...tags, ...(options.includeCollectionColumn ? [] : input.collections)];
    set('tags', allTags.filter(Boolean).join(', '));
    set('published_online_store', options.published ? TRUE : FALSE);
    set('status', statusLabel(product.shopify_status || options.defaultStatus));
    set('gift_card', FALSE);
    set('seo_title', product.seo_title ?? '');
    set('seo_description', product.seo_description ?? '');
    set('color_metafield', product.colour ?? '');
    set('google_condition', 'New');
    set('google_custom_product', FALSE);
    set('google_gender', (product.gender ?? '').toLowerCase() === 'men' ? 'Male' : (product.gender ?? '').toLowerCase() === 'women' ? 'Female' : 'Unisex');
    return row;
  };

  const variantFields = (variant: VariantRow | null, index: number): Record<string, unknown> => {
    const row: Record<string, unknown> = {};
    const set = (key: string, value: unknown) => {
      const column = byKey.get(key);
      if (column) row[column] = value;
    };
    const fallbackSku = index === 0 ? product.sku : '';
    set('variant_sku', variant?.sku ?? fallbackSku);
    set('variant_barcode', variant?.barcode ?? '');
    const first = optionNamesEmitted(index);
    set('option1_name', first ? (variant?.option1_name ?? 'Title') : '');
    set('option1_value', variant?.option1_value ?? 'Default Title');
    set('option2_name', first ? (variant?.option2_name ?? '') : '');
    set('option2_value', variant?.option2_value ?? '');
    set('option3_name', first ? (variant?.option3_name ?? '') : '');
    set('option3_value', variant?.option3_value ?? '');
    set('price', money(variant?.price ?? product.price));
    set('compare_at_price', money(variant?.compare_at_price ?? product.compare_at_price));
    set('cost_per_item', money(variant?.cost_price ?? product.cost_price));
    set('charge_tax', (variant?.taxable ?? product.taxable) === 1 ? TRUE : FALSE);
    set('tax_code', product.tax_code ?? '');
    const tracker = variant?.inventory_tracker ?? product.inventory_tracker;
    const tracking = (variant?.track_inventory ?? product.track_inventory) === 1;
    set('inventory_tracker', tracking ? tracker : '');
    set('inventory_quantity', tracking ? String(variant?.inventory_qty ?? product.inventory_qty ?? 0) : '');
    set('continue_selling', ((variant?.inventory_policy ?? product.inventory_policy) === 'continue' ? 'CONTINUE' : 'DENY'));
    set('weight_value', toGrams(variant?.weight ?? product.weight, variant?.weight_unit ?? product.weight_unit) ?? '');
    set('weight_unit', variant?.weight_unit ?? product.weight_unit ?? 'g');
    set('requires_shipping', (variant?.requires_shipping ?? product.requires_shipping) === 1 ? TRUE : FALSE);
    set('fulfillment_service', 'manual');
    set('variant_image', variant?.image_url ?? images[0]?.publicUrl ?? '');
    return row;
  };

  const imageFields = (image: ExportImage, position: number): Record<string, unknown> => {
    const row: Record<string, unknown> = {};
    const set = (key: string, value: unknown) => {
      const column = byKey.get(key);
      if (column) row[column] = value;
    };
    set('image_src', image.publicUrl ?? '');
    set('image_position', String(position));
    set('image_alt', image.altText ?? '');
    return row;
  };

  const handleColumn = byKey.get('url_handle');
  const rows: Record<string, unknown>[] = [];
  const variantCount = Math.max(variants.length, 1);

  for (let index = 0; index < variantCount; index += 1) {
    const variant = variants[index] ?? null;
    const row: Record<string, unknown> = {};
    if (index === 0 || options.repeatProductFields) Object.assign(row, productFields());
    else if (handleColumn) row[handleColumn] = product.handle ?? '';
    Object.assign(row, variantFields(variant, index));
    if (index === 0 && images.length > 0) Object.assign(row, imageFields(images[0], 1));
    if (options.includeCollectionColumn) row['Collection'] = input.collections[0] ?? '';
    rows.push(row);
  }

  for (let position = 1; position < images.length; position += 1) {
    const row: Record<string, unknown> = {};
    if (handleColumn) row[handleColumn] = product.handle ?? '';
    Object.assign(row, imageFields(images[position], position + 1));
    if (options.includeCollectionColumn) row['Collection'] = '';
    rows.push(row);
  }

  if (!has('title')) warnings.push(`${product.sku}: the mapping has no Title column — Shopify requires it for new products.`);
  if (!has('url_handle')) {
    warnings.push(`${product.sku}: the mapping has no URL handle column — required whenever a product has variants.`);
  }

  return { columns, rows, warnings };
}

export function buildCatalogCsv(
  products: ExportProductInput[],
  options: BuildOptions,
): { columns: string[]; rows: Record<string, unknown>[]; warnings: string[] } {
  const columns: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  for (const product of products) {
    const built = buildProductRows(product, options);
    if (columns.length === 0) columns.push(...built.columns);
    else {
      for (const column of built.columns) if (!columns.includes(column)) columns.push(column);
    }
    rows.push(...built.rows);
    warnings.push(...built.warnings);
  }
  return { columns, rows, warnings };
}
