import 'server-only';
import { all, get, json, parseJson, run, transaction } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { logAudit, diffChanges } from '@/lib/audit';
import { getSetting } from '@/lib/settings';
import { buildSkuPrefix, generateSku, loadExistingSkus, formatSequence } from '@/lib/sku';
import { slugify, uniqueHandle } from '@/lib/handle';
import { computeCompleteness, photographyCounters, type ProductBundle } from '@/lib/completeness';
import { assessReadiness } from '@/lib/readiness';
import {
  STATUS_LABELS,
  type AttributeFieldRow,
  type CollectionRow,
  type ProductImageRow,
  type ProductRow,
  type ProductStatus,
  type VariantRow,
} from '@/lib/types';
import { resolvePublicUrl } from '@/lib/storage';

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, sc.name AS subcategory_name,
         hc.name AS culture_name, hc.code AS culture_code,
         u.name AS assignee_name, cb.name AS creator_name,
         COALESCE(c.template_key, 'GENERIC') AS template_key
  FROM product p
  LEFT JOIN category c ON c.id = p.category_id
  LEFT JOIN category sc ON sc.id = p.subcategory_id
  LEFT JOIN handloom_culture hc ON hc.id = p.handloom_culture_id
  LEFT JOIN "user" u ON u.id = p.assignee_id
  LEFT JOIN "user" cb ON cb.id = p.created_by_id
`;

export const FIELD_LABELS: Record<string, string> = {
  sku: 'SKU', name: 'Product name', name_status: 'Name status', status: 'Status',
  internal_reference: 'Internal reference', category_id: 'Category', subcategory_id: 'Subcategory',
  handloom_culture_id: 'Handloom culture', region: 'Region', state: 'State', gender: 'Gender',
  target_audience: 'Target audience', occasion: 'Occasion', season: 'Season', tags: 'Tags',
  internal_notes: 'Internal notes', product_type_label: 'Product type', colour: 'Colour',
  fabric: 'Fabric', fabric_composition: 'Fabric composition', material: 'Material', weave: 'Weave',
  technique: 'Technique', pattern: 'Pattern', motifs: 'Motifs', border: 'Border', pallu: 'Pallu',
  weight: 'Weight', weight_unit: 'Weight unit', length_unit: 'Length unit',
  care_instructions: 'Care instructions', packaging_notes: 'Packaging notes',
  saree_length: 'Saree length', saree_width: 'Saree width', blouse_included: 'Blouse included',
  blouse_length: 'Blouse length', blouse_fabric: 'Blouse fabric', blouse_colour: 'Blouse colour',
  zari: 'Zari', transparency: 'Transparency', fall_pico_status: 'Fall / pico status',
  fit: 'Fit', neckline: 'Neckline', sleeve: 'Sleeve', garment_length: 'Garment length',
  closure: 'Closure', lining: 'Lining', pockets: 'Pockets', stretch: 'Stretch',
  artisan_name: 'Artisan / weaver', artisan_story: 'Weaver story', craft_story: 'Craft story',
  historical_context: 'Historical context', cultural_significance: 'Cultural significance',
  yarn: 'Yarn', zari_type: 'Zari type', dyeing_method: 'Dyeing method', embroidery: 'Embroidery',
  special_techniques: 'Special techniques', certification: 'Certification', origin: 'Origin',
  size_guide_id: 'Size guide', measurements: 'Measurements', short_description: 'Short description',
  full_description: 'Full description', story: 'The story', about_the_weave: 'About the weave',
  about_the_artisan: 'About the artisan', details: 'Details', care: 'Care',
  shipping_notes: 'Shipping / packaging notes', price: 'Price', compare_at_price: 'Compare-at price',
  cost_price: 'Cost price', currency: 'Currency', taxable: 'Taxable', tax_code: 'Tax code',
  discount_eligible: 'Discount eligible', inventory_qty: 'Inventory quantity',
  inventory_policy: 'Inventory policy', inventory_tracker: 'Inventory tracker',
  track_inventory: 'Track inventory', seo_title: 'SEO title', seo_description: 'SEO description',
  handle: 'Shopify handle', handle_locked: 'Handle locked (manual override)',
  shopify_status: 'Shopify status', published: 'Published', vendor: 'Vendor',
  template_suffix: 'Template suffix', requires_shipping: 'Requires shipping', hs_code: 'HS code',
  country_of_origin: 'Country of origin', assignee_id: 'Assigned to', is_archived: 'Archived',
};

export const EDITABLE_PRODUCT_COLUMNS = Object.keys(FIELD_LABELS).filter(
  (key) => !['sku', 'status', 'is_archived'].includes(key),
);

export function getProduct(id: string): ProductRow | undefined {
  return get<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = ?`, [id]);
}

export function getProductBySku(sku: string): ProductRow | undefined {
  return get<ProductRow>(`${PRODUCT_SELECT} WHERE p.sku = ?`, [sku]);
}

export interface ProductFilters {
  search?: string; status?: string[]; categoryId?: string; cultureId?: string;
  collectionId?: string; assigneeId?: string; colour?: string; fabric?: string; region?: string;
  readiness?: string[]; nameStatus?: string; priceMin?: number; priceMax?: number;
  createdAfter?: string; updatedAfter?: string; archived?: boolean;
  missingInfo?: boolean; missingPhotography?: boolean; awaitingApproval?: boolean;
  shopifyReady?: boolean; unassigned?: boolean;
  sortBy?: 'updated' | 'created' | 'sku' | 'name' | 'completeness' | 'price';
  sortDir?: 'asc' | 'desc'; limit?: number; offset?: number;
}

const SORT_COLUMNS: Record<string, string> = {
  updated: 'p.updated_at', created: 'p.created_at', sku: 'p.sku',
  name: 'p.name', completeness: 'p.completeness_score', price: 'p.price',
};

// Cache slots by template — rarely changes
const slotsCache = new Map<string, { data: Array<{ id: string; key: string; label: string; is_required: number }>; expiresAt: number }>();
const SLOTS_TTL = 5 * 60 * 1000;

export function listProducts(filters: ProductFilters = {}): { rows: ProductRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  where.push(filters.archived ? 'p.is_archived = 1' : 'p.is_archived = 0');
  const isSearch = Boolean(filters.search?.trim());
  if (isSearch) {
    const needle = `%${filters.search!.trim()}%`;
    where.push(
      `(p.sku LIKE ? OR COALESCE(p.name,'') LIKE ? OR COALESCE(p.internal_reference,'') LIKE ?
        OR COALESCE(p.handle,'') LIKE ? OR COALESCE(p.colour,'') LIKE ? OR COALESCE(p.fabric,'') LIKE ?
        OR COALESCE(hc.name,'') LIKE ? OR COALESCE(c.name,'') LIKE ? OR COALESCE(u.name,'') LIKE ?)`,
    );
    for (let i = 0; i < 9; i += 1) params.push(needle);
  }
  if (filters.status?.length) {
    where.push(`p.status IN (${filters.status.map(() => '?').join(',')})`);
    params.push(...filters.status);
  }
  if (filters.categoryId) {
    where.push('(p.category_id = ? OR p.subcategory_id = ?)');
    params.push(filters.categoryId, filters.categoryId);
  }
  if (filters.cultureId) { where.push('p.handloom_culture_id = ?'); params.push(filters.cultureId); }
  if (filters.collectionId) {
    where.push('EXISTS (SELECT 1 FROM product_collection pc WHERE pc.product_id = p.id AND pc.collection_id = ?)');
    params.push(filters.collectionId);
  }
  if (filters.assigneeId) { where.push('p.assignee_id = ?'); params.push(filters.assigneeId); }
  if (filters.unassigned) where.push('p.assignee_id IS NULL');
  if (filters.colour) { where.push('COALESCE(p.colour,\'\' ) LIKE ?'); params.push(`%${filters.colour}%`); }
  if (filters.fabric) { where.push('COALESCE(p.fabric,\'\' ) LIKE ?'); params.push(`%${filters.fabric}%`); }
  if (filters.region) {
    where.push('(COALESCE(p.region,\'\' ) LIKE ? OR COALESCE(p.state,\'\' ) LIKE ?)');
    params.push(`%${filters.region}%`, `%${filters.region}%`);
  }
  if (filters.readiness?.length) {
    where.push(`p.readiness_state IN (${filters.readiness.map(() => '?').join(',')})`);
    params.push(...filters.readiness);
  }
  if (filters.nameStatus) { where.push('p.name_status = ?'); params.push(filters.nameStatus); }
  if (typeof filters.priceMin === 'number') { where.push('COALESCE(p.price,0) >= ?'); params.push(filters.priceMin); }
  if (typeof filters.priceMax === 'number') { where.push('COALESCE(p.price,0) <= ?'); params.push(filters.priceMax); }
  if (filters.createdAfter) { where.push('p.created_at >= ?'); params.push(filters.createdAfter); }
  if (filters.updatedAfter) { where.push('p.updated_at >= ?'); params.push(filters.updatedAfter); }
  if (filters.missingInfo) where.push('p.completeness_score < 100');
  if (filters.missingPhotography) where.push('p.photography_required > 0 AND p.photography_complete < p.photography_required');
  if (filters.awaitingApproval) where.push(`p.status IN ('CONTENT_REVIEW','INTERNAL_REVIEW','FOUNDER_APPROVAL','CHANGES_REQUESTED')`);
  if (filters.shopifyReady) where.push(`p.status IN ('SHOPIFY_READY','EXPORTED','PUBLISHED')`);

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM product p
    LEFT JOIN category c ON c.id = p.category_id
    LEFT JOIN handloom_culture hc ON hc.id = p.handloom_culture_id
    LEFT JOIN "user" u ON u.id = p.assignee_id`;

  const total = isSearch
    ? (get<{ c: number }>(`SELECT COUNT(*) AS c ${from} ${clause}`, params, { noCache: true })?.c ?? 0)
    : (get<{ c: number }>(`SELECT COUNT(*) AS c ${from} ${clause}`, params, { ttlMs: 15_000 })?.c ?? 0);

  const sortColumn = SORT_COLUMNS[filters.sortBy ?? 'updated'] ?? 'p.updated_at';
  const direction = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(100, filters.limit ?? 25);
  const rows = isSearch
    ? all<ProductRow>(`${PRODUCT_SELECT} ${clause} ORDER BY ${sortColumn} ${direction}, p.sku ASC LIMIT ? OFFSET ?`, [...params, limit, filters.offset ?? 0], { noCache: true })
    : all<ProductRow>(`${PRODUCT_SELECT} ${clause} ORDER BY ${sortColumn} ${direction}, p.sku ASC LIMIT ? OFFSET ?`, [...params, limit, filters.offset ?? 0], { ttlMs: 15_000 });
  return { rows, total };
}

export function loadBundle(productId: string): ProductBundle | null {
  const product = getProduct(productId);
  if (!product) return null;
  return bundleFor(product);
}

export function bundleFor(product: ProductRow): ProductBundle {
  const templateKey = product.template_key || 'GENERIC';
  // Variants and images are product-specific — short cache
  const variants = all<VariantRow>('SELECT * FROM variant WHERE product_id = ? ORDER BY position, sku', [product.id], { ttlMs: 10_000 });
  const images = all<ProductImageRow>(
    `SELECT pi.*, s.key AS slot_key, s.label AS slot_label, s.file_suffix AS slot_suffix, u.name AS uploader_name
     FROM product_image pi
     LEFT JOIN image_slot_definition s ON s.id = pi.slot_id
     LEFT JOIN "user" u ON u.id = pi.uploaded_by_id
     WHERE pi.product_id = ?
     ORDER BY pi.sort_order, pi.created_at`,
    [product.id],
    { ttlMs: 10_000 },
  );
  const collections = all<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM collection c
     JOIN product_collection pc ON pc.collection_id = c.id
     WHERE pc.product_id = ? ORDER BY c.sort_order, c.name`,
    [product.id],
    { ttlMs: 20_000 },
  );
  // Slots rarely change — cache longer
  let slots: Array<{ id: string; key: string; label: string; is_required: number }>;
  const cachedSlots = slotsCache.get(templateKey);
  if (cachedSlots && Date.now() < cachedSlots.expiresAt) {
    slots = cachedSlots.data;
  } else {
    slots = all<{ id: string; key: string; label: string; is_required: number }>(
      `SELECT s.id, s.key, s.label, s.is_required
     FROM image_slot_definition s
     JOIN image_slot_template t ON t.id = s.template_id
     WHERE t.key = ? ORDER BY s.sort_order`,
      [templateKey],
      { ttlMs: 60_000 },
    );
    slotsCache.set(templateKey, { data: slots, expiresAt: Date.now() + SLOTS_TTL });
  }
  const attributes = all<AttributeFieldRow>(
    `SELECT f.*, v.value, COALESCE(v.is_missing,0) AS is_missing, v.note
     FROM attribute_field f
     LEFT JOIN product_attribute_value v ON v.field_id = f.id AND v.product_id = ?
     WHERE f.template_key = ? AND f.is_archived = 0
     ORDER BY f.group_key, f.sort_order, f.label`,
    [product.id, templateKey],
    { ttlMs: 10_000 },
  );
  const gaps = all<{ field_key: string; label: string; severity: string; status: string; section: string }>(
    'SELECT field_key, label, severity, status, section FROM product_gap WHERE product_id = ?',
    [product.id],
    { ttlMs: 10_000 },
  );
  return { product, variants, images, collections, slots, attributes, gaps };
}

export interface CreateProductInput {
  name?: string | null; categoryId?: string | null; subcategoryId?: string | null;
  handloomCultureId?: string | null; internalReference?: string | null;
  productTypeLabel?: string | null; sku?: string | null; assigneeId?: string | null; price?: number | null;
}

function allocateFreeSku(opts: { candidate: string; existingSkus: string[]; padding: number }): string {
  const taken = new Set(opts.existingSkus.map((sku) => sku.toUpperCase()));
  let candidate = opts.candidate;
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    if (!taken.has(candidate.toUpperCase())) return candidate;
    const match = /(.*?)-(\d+)$/.exec(candidate);
    const base = match?.[1] ?? candidate;
    const sequence = Number(match?.[2] ?? '0') + 1;
    candidate = `${base}-${formatSequence(sequence, opts.padding)}`;
  }
  throw new Error('Could not allocate a free SKU.');
}

export function createProduct(input: CreateProductInput, userId: string): ProductRow {
  const stamp = nowIso();
  const pattern = getSetting('sku.pattern');
  const padding = Number(getSetting('sku.sequence.padding')) || 3;
  const scope = getSetting('sku.sequence.scope') || 'CULTURE';

  const category = input.categoryId
    ? get<{ name: string; sku_segment: string | null; template_key: string }>('SELECT name, sku_segment, template_key FROM category WHERE id = ?', [input.categoryId])
    : null;
  const culture = input.handloomCultureId
    ? get<{ name: string; code: string }>('SELECT name, code FROM handloom_culture WHERE id = ?', [input.handloomCultureId])
    : null;

  let sku = input.sku?.trim() ? input.sku.trim().toUpperCase() : null;
  if (!sku) {
    const prefix = buildSkuPrefix(pattern, { type: category?.sku_segment, culture: culture?.code, category: category?.sku_segment });
    const existingSkus = loadExistingSkus();
    let scoped = existingSkus;
    if (scope === 'CULTURE' && culture?.code) {
      const needle = `-${culture.code.toUpperCase()}-`;
      scoped = existingSkus.filter((s) => s.toUpperCase().includes(needle));
    } else if (scope === 'CATEGORY' && category?.sku_segment) {
      const needle = `-${category.sku_segment.toUpperCase()}-`;
      scoped = existingSkus.filter((s) => s.toUpperCase().includes(needle));
    }
    sku = allocateFreeSku({ candidate: generateSku({ pattern, padding, prefix, existingSkus: scoped }), existingSkus, padding });
  }
  if (getProductBySku(sku)) throw new Error(`SKU ${sku} already exists.`);

  const id = cuid();
  const name = input.name?.trim() || null;
  const handle = name
    ? uniqueHandle(name, all<{ handle: string }>('SELECT handle FROM product WHERE handle IS NOT NULL').map((r) => r.handle), sku)
    : null;

  transaction(() => {
    run(
      `INSERT INTO product
         (id, sku, internal_reference, name, name_status, status, category_id, subcategory_id,
          handloom_culture_id, product_type_label, assignee_id, price, handle, created_by_id, modified_by_id,
          currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sku, input.internalReference ?? null, name, name ? 'NAME_PROPOSED' : 'NOT_NAMED',
        input.categoryId ?? null, input.subcategoryId ?? null, input.handloomCultureId ?? null,
        input.productTypeLabel ?? category?.name ?? null, input.assigneeId ?? null, input.price ?? null,
        handle, userId, userId, getSetting('units.currency') || 'INR', stamp, stamp],
    );
    run(
      `INSERT INTO variant
         (id, product_id, sku, title, position, option1_name, option1_value, price, inventory_qty,
          weight_unit, created_at, updated_at)
       VALUES (?, ?, ?, 'Default', 1, 'Title', 'Default Title', ?, 0, ?, ?, ?)`,
      [cuid(), id, sku, input.price ?? null, getSetting('units.weight') || 'g', stamp, stamp],
    );
    logAudit({ entityType: 'PRODUCT', entityId: id, entityLabel: sku, action: 'CREATE', userId, changes: [{ field: 'sku', label: 'SKU', oldValue: null, newValue: sku }] });
  });

  const created = getProduct(id);
  if (!created) throw new Error('Product was created but could not be re-read.');
  recomputeProduct(id, userId, { skipAudit: true });
  return getProduct(id) as ProductRow;
}

export interface UpdateResult {
  product: ProductRow;
  changes: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }>;
}

export function updateProduct(productId: string, patch: Record<string, unknown>, userId: string, opts: { action?: string; reason?: string } = {}): UpdateResult {
  const before = getProduct(productId);
  if (!before) throw new Error('Product not found.');
  const sets: string[] = []; const params: unknown[] = [];
  const changes: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE_PRODUCT_COLUMNS.includes(key)) continue;
    const stored = value === undefined ? null : value;
    sets.push(`${key} = ?`); params.push(stored);
    changes.push({ field: key, label: FIELD_LABELS[key] ?? key, oldValue: (before as unknown as Record<string, unknown>)[key] ?? null, newValue: stored ?? null });
  }
  if (patch.name !== undefined && patch.name_status === undefined) {
    const nextName = (patch.name as string | null)?.trim();
    const nextStatus = nextName ? 'NAME_PROPOSED' : 'NOT_NAMED';
    if (nextStatus !== before.name_status) {
      sets.push('name_status = ?'); params.push(nextStatus);
      changes.push({ field: 'name_status', label: 'Name status', oldValue: before.name_status, newValue: nextStatus });
    }
    const lockedNow = patch.handle_locked !== undefined ? Number(patch.handle_locked) === 1 : before.handle_locked === 1;
    if (nextName && !lockedNow && patch.handle === undefined) {
      const handles = all<{ handle: string }>('SELECT handle FROM product WHERE handle IS NOT NULL AND id != ?', [productId]).map((r) => r.handle);
      const nextHandle = uniqueHandle(nextName, handles, before.sku);
      if (nextHandle !== before.handle) {
        sets.push('handle = ?'); params.push(nextHandle);
        changes.push({ field: 'handle', label: 'Shopify handle', oldValue: before.handle, newValue: nextHandle });
      }
    }
  }
  if (sets.length > 0) {
    const stamp = nowIso();
    run(`UPDATE product SET ${sets.join(', ')}, modified_by_id = ?, updated_at = ? WHERE id = ?`, [...params, userId, stamp, productId]);
  }
  const meaningful = changes.filter((change) => JSON.stringify(change.oldValue) !== JSON.stringify(change.newValue));
  if (meaningful.length > 0) {
    snapshotProduct(productId, userId, opts.reason ?? 'edit');
    logAudit({ entityType: 'PRODUCT', entityId: productId, entityLabel: before.sku, action: opts.action ?? 'UPDATE', changes: meaningful, userId });
  }
  recomputeProduct(productId, userId, { skipAudit: true });
  return { product: getProduct(productId) as ProductRow, changes: meaningful };
}

export function setAttributeValues(productId: string, values: Array<{ fieldId: string; value: string; isMissing?: boolean; note?: string | null }>, userId: string): void {
  const before = getProduct(productId);
  if (!before) throw new Error('Product not found.');
  const existing = all<{ field_id: string; value: string; is_missing: number; label: string }>(
    `SELECT v.field_id, v.value, v.is_missing, f.label FROM product_attribute_value v JOIN attribute_field f ON f.id = v.field_id WHERE v.product_id = ?`, [productId],
  );
  const beforeMap = new Map(existing.map((row) => [row.field_id, row]));
  const changes: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }> = [];
  for (const entry of values) {
    const label = get<{ label: string }>('SELECT label FROM attribute_field WHERE id = ?', [entry.fieldId])?.label ?? entry.fieldId;
    const previous = beforeMap.get(entry.fieldId);
    const nextValue = entry.value ?? ''; const nextMissing = entry.isMissing ? 1 : 0;
    if (previous && previous.value === nextValue && previous.is_missing === nextMissing) continue;
    run(`INSERT INTO product_attribute_value (id, product_id, field_id, value, is_missing, note) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(product_id, field_id) DO UPDATE SET value = excluded.value, is_missing = excluded.is_missing, note = excluded.note`,
      [cuid(), productId, entry.fieldId, nextValue, nextMissing, entry.note ?? null]);
    changes.push({ field: `attr:${entry.fieldId}`, label, oldValue: previous ? (previous.is_missing ? 'MISSING — INFORMATION REQUIRED' : previous.value) : null, newValue: nextMissing ? 'MISSING — INFORMATION REQUIRED' : nextValue });
  }
  if (changes.length > 0) {
    logAudit({ entityType: 'PRODUCT', entityId: productId, entityLabel: before.sku, action: 'UPDATE', changes, userId });
    snapshotProduct(productId, userId, 'attribute edit');
  }
  run('UPDATE product SET modified_by_id = ?, updated_at = ? WHERE id = ?', [userId, nowIso(), productId]);
  recomputeProduct(productId, userId, { skipAudit: true });
}

export function snapshotProduct(productId: string, userId: string | null, reason?: string): void {
  const product = getProduct(productId);
  if (!product) return;
  const nextVersion = (get<{ v: number }>('SELECT COALESCE(MAX(version),0) + 1 AS v FROM product_snapshot WHERE product_id = ?', [productId])?.v ?? 1);
  const tracked: Record<string, unknown> = {};
  for (const key of ['name', 'name_status', 'status', 'price', 'compare_at_price', 'cost_price', 'short_description', 'full_description', 'story', 'about_the_weave', 'care', 'measurements', 'category_id', 'handloom_culture_id', 'seo_title', 'seo_description', 'handle', 'shopify_status', 'tags']) {
    tracked[key] = (product as unknown as Record<string, unknown>)[key];
  }
  run(`INSERT INTO product_snapshot (id, product_id, version, reason, data, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [cuid(), productId, nextVersion, reason ?? null, json(tracked), userId, nowIso()]);
}

export function setProductStatus(productId: string, status: ProductStatus, userId: string, opts: { comment?: string; decision?: string; checklist?: Record<string, boolean> } = {}): void {
  const before = getProduct(productId);
  if (!before) throw new Error('Product not found.');
  if (before.status === status) return;
  if (opts.decision) {
    run(`INSERT INTO product_review (id, product_id, user_id, decision, checklist, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cuid(), productId, userId, opts.decision, json(opts.checklist ?? {}), opts.comment ?? null, nowIso()]);
  }
  snapshotProduct(productId, userId, `status → ${STATUS_LABELS[status] ?? status}`);
  run('UPDATE product SET status = ?, modified_by_id = ?, updated_at = ? WHERE id = ?', [status, userId, nowIso(), productId]);
  logAudit({ entityType: 'PRODUCT', entityId: productId, entityLabel: before.sku, action: opts.decision ?? 'STATUS_CHANGE', changes: [{ field: 'status', label: 'Status', oldValue: before.status, newValue: status }], meta: opts.comment ? { comment: opts.comment } : null, userId });
}

export function archiveProduct(productId: string, archived: boolean, userId: string): void {
  const before = getProduct(productId);
  if (!before) return;
  run('UPDATE product SET is_archived = ?, status = ?, modified_by_id = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, archived ? 'ARCHIVED' : 'DRAFT', userId, nowIso(), productId]);
  logAudit({ entityType: 'PRODUCT', entityId: productId, entityLabel: before.sku, action: archived ? 'ARCHIVE' : 'RESTORE', changes: [{ field: 'is_archived', label: 'Archived', oldValue: before.is_archived, newValue: archived ? 1 : 0 }], userId });
}

export function deleteProduct(productId: string, userId: string): void {
  const before = getProduct(productId);
  if (!before) return;
  run('DELETE FROM product WHERE id = ?', [productId]);
  logAudit({ entityType: 'PRODUCT', entityId: productId, entityLabel: before.sku, action: 'DELETE', changes: [{ field: 'sku', label: 'SKU', oldValue: before.sku, newValue: null }], userId });
}

export function recomputeProduct(productId: string, _userId?: string, opts: { skipAudit?: boolean } = {}): { completeness: number; readiness: string } {
  const bundle = loadBundle(productId);
  if (!bundle) return { completeness: 0, readiness: 'BLOCKED' };
  const completeness = computeCompleteness(bundle);
  const photo = photographyCounters(bundle);
  const otherHandles = all<{ handle: string }>('SELECT handle FROM product WHERE handle IS NOT NULL AND id != ?', [productId], { ttlMs: 30_000 }).map((r) => r.handle.toLowerCase());
  const otherSkus = all<{ sku: string }>('SELECT sku FROM product WHERE id != ?', [productId], { ttlMs: 30_000 }).map((r) => r.sku.toUpperCase());
  const imagesPublic = bundle.images.every((img) =>
    Boolean(resolvePublicUrl({ storageBackend: img.storage_backend, storageKey: img.storage_key, driveFileId: img.drive_file_id, publicUrl: img.public_url })));
  const readiness = assessReadiness(bundle, { usedHandles: new Set(otherHandles), usedSkus: new Set(otherSkus), imagesPubliclyAccessible: bundle.images.length > 0 ? imagesPublic : undefined });
  run(`UPDATE product SET completeness_score = ?, readiness_state = ?, readiness_score = ?, readiness_issues = ?, photography_complete = ?, photography_required = ? WHERE id = ?`,
    [completeness.score, readiness.state, readiness.score, json(readiness.issues), photo.complete, photo.required, productId]);
  void opts;
  return { completeness: completeness.score, readiness: readiness.state };
}

export function recomputeAllProducts(): number {
  const ids = all<{ id: string }>('SELECT id FROM product').map((r) => r.id);
  for (const id of ids) recomputeProduct(id);
  return ids.length;
}

export function setProductCollections(productId: string, collectionIds: string[], userId: string): void {
  const before = getProduct(productId);
  if (!before) return;
  const current = all<{ collection_id: string; name: string }>(`SELECT pc.collection_id, c.name FROM product_collection pc JOIN collection c ON c.id = pc.collection_id WHERE pc.product_id = ?`, [productId]);
  const currentIds = new Set(current.map((r) => r.collection_id));
  const nextIds = new Set(collectionIds);
  for (const id of currentIds) { if (!nextIds.has(id)) run('DELETE FROM product_collection WHERE product_id = ? AND collection_id = ?', [productId, id]); }
  for (const id of nextIds) { if (!currentIds.has(id)) run(`INSERT INTO product_collection (id, product_id, collection_id, added_by_id, created_at) VALUES (?, ?, ?, ?, ?)`, [cuid(), productId, id, userId, nowIso()]); }
  const names = all<{ id: string; name: string }>('SELECT id, name FROM collection').reduce<Record<string, string>>((acc, row) => ({ ...acc, [row.id]: row.name }), {});
  const oldNames = current.map((r) => r.name).sort(); const newNames = [...nextIds].map((id) => names[id] ?? id).sort();
  if (oldNames.join('|') !== newNames.join('|')) {
    logAudit({ entityType: 'PRODUCT', entityId: productId, entityLabel: before.sku, action: 'UPDATE', changes: [{ field: 'collections', label: 'Collections', oldValue: oldNames, newValue: newNames }], userId });
  }
  run('UPDATE product SET modified_by_id = ?, updated_at = ? WHERE id = ?', [userId, nowIso(), productId]);
  recomputeProduct(productId, userId, { skipAudit: true });
}

export function getProductCollections(productId: string): CollectionRow[] {
  return all<CollectionRow>(`SELECT c.* FROM collection c JOIN product_collection pc ON pc.collection_id = c.id WHERE pc.product_id = ? ORDER BY c.sort_order, c.name`, [productId]);
}

export function productTags(product: ProductRow): string[] {
  return parseJson<string[]>(product.tags, []).filter((t): t is string => typeof t === 'string');
}
export function productDetails(product: ProductRow): string[] {
  return parseJson<string[]>(product.details, []).filter((d): d is string => typeof d === 'string');
}
export function productMeasurements(product: ProductRow): Array<{ label: string; value: string; unit: string }> {
  return parseJson<Array<{ label: string; value: string; unit: string }>>(product.measurements, []);
}
export function displayStatus(status: ProductStatus): string { return STATUS_LABELS[status] ?? status; }
export function slugFor(value: string): string { return slugify(value); }
export function diffFor(before: Record<string, unknown>, after: Record<string, unknown>) { return diffChanges(before, after, FIELD_LABELS); }
