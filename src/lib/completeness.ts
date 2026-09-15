/**
 * Product completeness engine (spec §7).
 *
 * Pure and deterministic: it takes a fully-loaded product bundle and returns a
 * percentage plus the exact list of what is missing. The catalog UI, the
 * dashboard tiles and the workflow gating all read from this single function
 * so the numbers can never disagree.
 */
import type { AttributeFieldRow, ProductImageRow, ProductRow, VariantRow } from '@/lib/types';
import { parseJson } from '@/lib/db';

export type CompletenessSection =
  | 'BASIC'
  | 'CLASSIFICATION'
  | 'SPECIFICATION'
  | 'HANDLOOM'
  | 'MEASUREMENTS'
  | 'CONTENT'
  | 'IMAGES'
  | 'SEO'
  | 'PRICING'
  | 'VARIANTS'
  | 'COLLECTIONS';

export const SECTION_LABELS: Record<CompletenessSection, string> = {
  BASIC: 'Basic information',
  CLASSIFICATION: 'Classification',
  SPECIFICATION: 'Product details',
  HANDLOOM: 'Handloom & craft',
  MEASUREMENTS: 'Measurements',
  CONTENT: 'Story & content',
  IMAGES: 'Photography',
  SEO: 'SEO',
  PRICING: 'Pricing',
  VARIANTS: 'Variants',
  COLLECTIONS: 'Collections',
};

export interface CompletenessItem {
  section: CompletenessSection;
  field: string;
  label: string;
  severity: 'REQUIRED' | 'RECOMMENDED';
}

export interface CompletenessResult {
  score: number;
  missing: CompletenessItem[];
  requiredMissing: CompletenessItem[];
  bySection: Record<CompletenessSection, { total: number; done: number; missing: CompletenessItem[] }>;
}

export interface ProductBundle {
  product: ProductRow;
  variants: VariantRow[];
  images: ProductImageRow[];
  collections: Array<{ id: string; name: string }>;
  slots: Array<{ id: string; key: string; label: string; is_required: number }>;
  attributes: AttributeFieldRow[];
  gaps: Array<{ field_key: string; label: string; severity: string; status: string; section: string }>;
}

function filled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function listFilled(json: string | null | undefined): boolean {
  const parsed = parseJson<unknown[]>(json ?? '[]', []);
  return Array.isArray(parsed) && parsed.filter((v) => filled(v)).length > 0;
}

export function templateKeyFor(product: ProductRow): string {
  return product.template_key || 'GENERIC';
}

/** Handloom products are sarees and any category bound to the SAREE template. */
export function isHandloomProduct(product: ProductRow): boolean {
  return templateKeyFor(product) === 'SAREE';
}

const SPEC_FIELDS: Record<string, Array<[keyof ProductRow, string]>> = {
  SAREE: [
    ['fabric', 'Fabric'],
    ['fabric_composition', 'Fabric composition'],
    ['weave', 'Weave'],
    ['technique', 'Technique'],
    ['colour', 'Colour'],
    ['border', 'Border'],
    ['pallu', 'Pallu'],
    ['pattern', 'Pattern'],
    ['motifs', 'Motifs'],
    ['saree_length', 'Saree length'],
    ['saree_width', 'Saree width'],
    ['blouse_included', 'Blouse included'],
    ['care_instructions', 'Care instructions'],
  ],
  APPAREL: [
    ['fabric', 'Fabric'],
    ['fabric_composition', 'Fabric composition'],
    ['weave', 'Weave'],
    ['colour', 'Colour'],
    ['fit', 'Fit'],
    ['neckline', 'Neckline'],
    ['sleeve', 'Sleeve'],
    ['garment_length', 'Length'],
    ['care_instructions', 'Care instructions'],
  ],
  GENERIC: [
    ['fabric', 'Fabric'],
    ['colour', 'Colour'],
    ['material', 'Material'],
    ['care_instructions', 'Care instructions'],
  ],
};

const HANDLOOM_FIELDS: Array<[keyof ProductRow, string, 'REQUIRED' | 'RECOMMENDED']> = [
  ['yarn', 'Yarn', 'RECOMMENDED'],
  ['zari_type', 'Zari type', 'RECOMMENDED'],
  ['dyeing_method', 'Dyeing method', 'RECOMMENDED'],
  ['craft_story', 'Craft story', 'REQUIRED'],
  ['historical_context', 'Historical context', 'RECOMMENDED'],
  ['cultural_significance', 'Cultural significance', 'RECOMMENDED'],
  ['artisan_name', 'Artisan / weaver', 'REQUIRED'],
  ['artisan_story', 'Weaver story', 'RECOMMENDED'],
];

interface Check {
  section: CompletenessSection;
  field: string;
  label: string;
  severity: 'REQUIRED' | 'RECOMMENDED';
  ok: boolean;
}

const ALL_SECTIONS: CompletenessSection[] = [
  'BASIC', 'CLASSIFICATION', 'SPECIFICATION', 'HANDLOOM', 'MEASUREMENTS',
  'CONTENT', 'IMAGES', 'SEO', 'PRICING', 'VARIANTS', 'COLLECTIONS',
];

export function computeCompleteness(bundle: ProductBundle): CompletenessResult {
  const { product } = bundle;
  const checks: Check[] = [];

  const openGaps = bundle.gaps.filter((g) => g.status === 'OPEN');

  const check = (
    section: CompletenessSection,
    field: string,
    label: string,
    ok: boolean,
    severity: 'REQUIRED' | 'RECOMMENDED' = 'REQUIRED',
  ) => {
    checks.push({ section, field, label, severity, ok: Boolean(ok) });
  };

  // --- BASIC ---------------------------------------------------------------
  check('BASIC', 'sku', 'SKU', filled(product.sku));
  check('BASIC', 'name', 'Product name', filled(product.name));
  check('BASIC', 'internal_reference', 'Internal reference', filled(product.internal_reference), 'RECOMMENDED');

  // --- CLASSIFICATION ------------------------------------------------------
  check('CLASSIFICATION', 'category_id', 'Category', filled(product.category_id));
  check('CLASSIFICATION', 'handloom_culture_id', 'Handloom culture',
    isHandloomProduct(product) ? filled(product.handloom_culture_id) : true);
  check('CLASSIFICATION', 'region', 'Region', filled(product.region || product.state), 'RECOMMENDED');
  check('CLASSIFICATION', 'gender', 'Gender', filled(product.gender), 'RECOMMENDED');
  check('CLASSIFICATION', 'occasion', 'Occasion', filled(product.occasion), 'RECOMMENDED');
  check('CLASSIFICATION', 'season', 'Season', filled(product.season), 'RECOMMENDED');

  // --- SPECIFICATION -------------------------------------------------------
  const specFields = SPEC_FIELDS[templateKeyFor(product)] ?? SPEC_FIELDS.GENERIC;
  for (const [field, label] of specFields) {
    check('SPECIFICATION', field as string, label, filled(product[field]));
  }

  // --- HANDLOOM (handloom products only) ------------------------------------
  if (isHandloomProduct(product)) {
    for (const [field, label, severity] of HANDLOOM_FIELDS) {
      check('HANDLOOM', field as string, label, filled(product[field]), severity);
    }
  }

  // --- Dynamic attribute fields ---------------------------------------------
  for (const attr of bundle.attributes) {
    if (attr.is_archived === 1) continue;
    const section: CompletenessSection =
      attr.group_key === 'HANDLOOM' ? 'HANDLOOM'
      : attr.group_key === 'MEASUREMENT' ? 'MEASUREMENTS'
      : attr.group_key === 'CONTENT' ? 'CONTENT'
      : 'SPECIFICATION';
    const severity = attr.is_required === 1 ? 'REQUIRED' : 'RECOMMENDED';
    // An explicit "MISSING - INFORMATION REQUIRED" flag always counts as absent.
    check(section, `attr:${attr.key}`, attr.label, filled(attr.value) && attr.is_missing !== 1, severity);
  }

  // --- MEASUREMENTS ---------------------------------------------------------
  if (isHandloomProduct(product)) {
    check('MEASUREMENTS', 'measurements', 'Product measurements', listFilled(product.measurements));
  } else {
    check('MEASUREMENTS', 'size_guide_id', 'Size guide assigned', filled(product.size_guide_id));
    check('MEASUREMENTS', 'measurements', 'Product measurements', listFilled(product.measurements), 'RECOMMENDED');
  }

  // --- CONTENT ---------------------------------------------------------------
  check('CONTENT', 'short_description', 'Short description', filled(product.short_description));
  check('CONTENT', 'full_description', 'Full description', filled(product.full_description));
  check('CONTENT', 'story', 'The story', filled(product.story));
  if (isHandloomProduct(product)) {
    check('CONTENT', 'about_the_weave', 'About the weave', filled(product.about_the_weave));
  }
  check('CONTENT', 'details', 'Details (bullets)', listFilled(product.details), 'RECOMMENDED');
  check('CONTENT', 'care', 'Care instructions', filled(product.care || product.care_instructions));

  // --- IMAGES -----------------------------------------------------------------
  const requiredSlots = bundle.slots.filter((s) => s.is_required === 1);
  if (requiredSlots.length === 0) {
    check('IMAGES', 'hero', 'Hero image', bundle.images.length > 0);
  } else {
    for (const slot of requiredSlots) {
      check('IMAGES', `slot:${slot.key}`, slot.label, bundle.images.some((img) => img.slot_id === slot.id));
    }
  }

  // --- SEO ---------------------------------------------------------------------
  // Shopify falls back to Title / Description when these are blank, so they
  // are recommended rather than export-blocking.
  check('SEO', 'seo_title', 'SEO title', filled(product.seo_title), 'RECOMMENDED');
  check('SEO', 'seo_description', 'SEO description', filled(product.seo_description), 'RECOMMENDED');
  check('SEO', 'handle', 'URL handle', filled(product.handle));

  // --- PRICING ------------------------------------------------------------------
  check('PRICING', 'price', 'Price', filled(product.price));
  check('PRICING', 'currency', 'Currency', filled(product.currency));
  check('PRICING', 'cost_price', 'Cost price', filled(product.cost_price), 'RECOMMENDED');

  // --- VARIANTS --------------------------------------------------------------------
  check('VARIANTS', 'variants', 'At least one variant', bundle.variants.length > 0);
  check('VARIANTS', 'variant_sku', 'Variant SKUs',
    bundle.variants.length === 0 || bundle.variants.every((v) => filled(v.sku)));

  // --- COLLECTIONS -------------------------------------------------------------------
  check('COLLECTIONS', 'collections', 'At least one collection', bundle.collections.length > 0);

  // Gaps explicitly declared by the team always count, even when the automatic
  // check for that field passes.
  const seenFields = new Set(checks.map((c) => c.field));
  for (const gap of openGaps) {
    if (seenFields.has(gap.field_key)) continue;
    const section = ALL_SECTIONS.includes(gap.section as CompletenessSection)
      ? (gap.section as CompletenessSection)
      : 'SPECIFICATION';
    check(section, gap.field_key, gap.label, false, gap.severity === 'REQUIRED' ? 'REQUIRED' : 'RECOMMENDED');
  }

  // --- Roll up ---------------------------------------------------------------------
  const bySection = {} as Record<CompletenessSection, { total: number; done: number; missing: CompletenessItem[] }>;
  for (const section of ALL_SECTIONS) bySection[section] = { total: 0, done: 0, missing: [] };
  for (const c of checks) {
    const bucket = bySection[c.section];
    bucket.total += 1;
    if (c.ok) bucket.done += 1;
    else bucket.missing.push({ section: c.section, field: c.field, label: c.label, severity: c.severity });
  }

  const missing = ALL_SECTIONS.flatMap((s) => bySection[s].missing);
  const requiredMissing = missing.filter((m) => m.severity === 'REQUIRED');

  // Required checks weigh 1.0, recommended checks 0.5.
  let weightTotal = 0;
  let weightDone = 0;
  for (const c of checks) {
    const weight = c.severity === 'REQUIRED' ? 1 : 0.5;
    weightTotal += weight;
    if (c.ok) weightDone += weight;
  }
  const score = weightTotal === 0 ? 0 : Math.max(0, Math.min(100, Math.round((weightDone / weightTotal) * 100)));

  return { score, missing, requiredMissing, bySection };
}

/** Photography counters used by the dashboard and the product sidebar. */
export function photographyCounters(bundle: Pick<ProductBundle, 'images' | 'slots'>): { complete: number; required: number } {
  const requiredSlots = bundle.slots.filter((s) => s.is_required === 1);
  const complete = requiredSlots.filter((slot) => bundle.images.some((img) => img.slot_id === slot.id)).length;
  return { complete, required: requiredSlots.length };
}
