/**
 * Shopify readiness validation engine (spec §30/§36).
 *
 * Three states, never ambiguous:
 *   READY    — green,  can be exported
 *   WARNINGS — yellow, exportable with an explicit admin override
 *   BLOCKED  — red,    cannot be exported, full issue list shown
 *
 * The engine is pure so it can be unit tested and reused by the export
 * preview, the product sidebar and the bulk validator.
 */
import { computeCompleteness, type ProductBundle } from '@/lib/completeness';
import { handleIssues } from '@/lib/handle';
import type { Issue, ProductRow, ReadinessState } from '@/lib/types';

export interface ReadinessContext {
  /** Handles already used by other products (lowercased). */
  usedHandles?: Set<string>;
  /** SKUs already used by other products (uppercased). */
  usedSkus?: Set<string>;
  /** Whether the images on this product resolve to a public URL. */
  imagesPubliclyAccessible?: boolean;
}

export interface ReadinessResult {
  state: ReadinessState;
  score: number;
  issues: Issue[];
  errors: Issue[];
  warnings: Issue[];
}

const err = (code: string, message: string, section?: string): Issue => ({ code, message, severity: 'ERROR', section });
const warn = (code: string, message: string, section?: string): Issue => ({ code, message, severity: 'WARNING', section });

export function assessReadiness(bundle: ProductBundle, context: ReadinessContext = {}): ReadinessResult {
  const { product } = bundle;
  const issues: Issue[] = [];
  const completeness = computeCompleteness(bundle);

  // --- Identity --------------------------------------------------------------
  if (!product.sku?.trim()) issues.push(err('MISSING_SKU', 'SKU is missing.', 'BASIC'));
  if (!product.name?.trim()) issues.push(err('MISSING_NAME', 'Product name is missing.', 'BASIC'));
  if (product.name_status === 'NOT_NAMED' || product.name_status === 'NAMING_REQUIRED') {
    issues.push(err('NAME_NOT_APPROVED', 'The product name has not been through the naming workflow.', 'BASIC'));
  }
  if (product.name_status === 'NAME_PROPOSED') {
    issues.push(warn('NAME_PENDING', 'A name is proposed but not yet approved.', 'BASIC'));
  }

  // --- Classification ----------------------------------------------------------
  if (!product.category_id) issues.push(err('MISSING_CATEGORY', 'No category assigned.', 'CLASSIFICATION'));

  // --- Pricing -------------------------------------------------------------------
  const variants = bundle.variants;
  const hasProductPrice = typeof product.price === 'number' && product.price > 0;
  const variantsPriced = variants.length > 0 && variants.every((v) => typeof v.price === 'number' && v.price > 0);
  if (!hasProductPrice && !variantsPriced) {
    issues.push(err('MISSING_PRICE', 'No price set on the product or its variants.', 'PRICING'));
  }
  if (typeof product.price === 'number' && product.price < 0) {
    issues.push(err('NEGATIVE_PRICE', 'Price cannot be negative.', 'PRICING'));
  }
  if (
    typeof product.compare_at_price === 'number' &&
    typeof product.price === 'number' &&
    product.compare_at_price > 0 &&
    product.compare_at_price < product.price
  ) {
    issues.push(warn('COMPARE_BELOW_PRICE', 'Compare-at price is lower than the selling price.', 'PRICING'));
  }
  if (typeof product.cost_price !== 'number' || product.cost_price <= 0) {
    issues.push(warn('MISSING_COST', 'Cost price is not set — margin reporting will be incomplete.', 'PRICING'));
  }

  // --- Description ------------------------------------------------------------------
  if (!product.short_description?.trim() && !product.full_description?.trim()) {
    issues.push(err('MISSING_DESCRIPTION', 'Neither a short nor a full description is present.', 'CONTENT'));
  } else if (!product.full_description?.trim()) {
    issues.push(warn('MISSING_FULL_DESCRIPTION', 'Full description is empty.', 'CONTENT'));
  }
  if (!product.story?.trim()) issues.push(warn('MISSING_STORY', 'The product story is empty.', 'CONTENT'));

  // --- Required attributes / measurements ------------------------------------------------
  for (const item of completeness.requiredMissing) {
    if (item.section === 'IMAGES') continue; // handled below with slot detail
    // handle, name, sku, category and price are all reported explicitly above;
    // repeating them from the completeness gaps produced duplicate entries.
    if (['name', 'sku', 'category_id', 'price', 'short_description', 'full_description', 'handle'].includes(item.field)) continue;
    issues.push(err(`MISSING_${item.field.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`, `${item.label} is missing.`, item.section));
  }
  for (const item of completeness.missing.filter((m) => m.severity === 'RECOMMENDED')) {
    if (item.section === 'IMAGES') continue;
    issues.push(warn(`RECOMMENDED_${item.field.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`, `${item.label} is recommended.`, item.section));
  }

  // --- Images ----------------------------------------------------------------------------
  const requiredSlots = bundle.slots.filter((s) => s.is_required === 1);
  if (bundle.images.length === 0) {
    issues.push(err('NO_IMAGES', 'No images uploaded.', 'IMAGES'));
  } else {
    const hasHero =
      bundle.images.some((img) => img.is_primary === 1) ||
      bundle.images.some((img) => img.slot_key === 'HERO');
    if (!hasHero) issues.push(err('MISSING_HERO', 'No hero / primary image marked.', 'IMAGES'));
    for (const slot of requiredSlots) {
      if (!bundle.images.some((img) => img.slot_id === slot.id)) {
        issues.push(err(`MISSING_IMAGE_${slot.key}`, `Required image missing: ${slot.label}.`, 'IMAGES'));
      }
    }
    const withoutAlt = bundle.images.filter((img) => !img.alt_text?.trim());
    if (withoutAlt.length > 0) {
      issues.push(warn('MISSING_ALT', `${withoutAlt.length} image(s) have no alt text.`, 'IMAGES'));
    }
    const unapproved = bundle.images.filter((img) => img.review_status !== 'APPROVED');
    if (unapproved.length > 0) {
      issues.push(warn('IMAGES_UNAPPROVED', `${unapproved.length} image(s) are not approved by photography.`, 'IMAGES'));
    }
    if (context.imagesPubliclyAccessible === false) {
      issues.push(warn('IMAGES_NOT_PUBLIC', 'Images are not available at a public URL, so Shopify cannot import them.', 'IMAGES'));
    }
  }

  // --- Collections ----------------------------------------------------------------------------
  if (bundle.collections.length === 0) {
    issues.push(err('NO_COLLECTION', 'No collection assigned.', 'COLLECTIONS'));
  }

  // --- Handle / SEO --------------------------------------------------------------------------
  if (!product.handle?.trim()) {
    issues.push(err('MISSING_HANDLE', 'Shopify handle is missing.', 'SEO'));
  } else {
    for (const problem of handleIssues(product.handle)) {
      issues.push(err('INVALID_HANDLE', problem, 'SEO'));
    }
    const normalized = product.handle.toLowerCase();
    if (context.usedHandles?.has(normalized)) {
      issues.push(err('DUPLICATE_HANDLE', `Handle "${product.handle}" is already used by another product.`, 'SEO'));
    }
  }
  if (!product.seo_title?.trim()) issues.push(warn('MISSING_SEO_TITLE', 'SEO title is empty.', 'SEO'));
  if (!product.seo_description?.trim()) issues.push(warn('MISSING_SEO_DESCRIPTION', 'SEO description is empty.', 'SEO'));
  if (product.seo_description && product.seo_description.length > 320) {
    issues.push(warn('SEO_DESCRIPTION_LONG', 'SEO description exceeds 320 characters and may be truncated.', 'SEO'));
  }

  // --- Variants ---------------------------------------------------------------------------------
  if (variants.length > 0) {
    const skus = variants.map((v) => v.sku?.trim()).filter(Boolean) as string[];
    const duplicateVariantSkus = skus.filter((sku, index) => skus.indexOf(sku) !== index);
    if (duplicateVariantSkus.length > 0) {
      issues.push(err('DUPLICATE_VARIANT_SKU', `Duplicate variant SKU(s): ${[...new Set(duplicateVariantSkus)].join(', ')}.`, 'VARIANTS'));
    }
    const combos = variants.map((v) => [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join('|'));
    const duplicateCombos = combos.filter((c, i) => combos.indexOf(c) !== i);
    if (duplicateCombos.length > 0) {
      issues.push(err('DUPLICATE_OPTION_COMBO', 'Two variants share the same option value combination.', 'VARIANTS'));
    }
    const missingSize = variants.filter((v) => !v.option1_value?.trim());
    if (missingSize.length > 0) {
      issues.push(err('MISSING_VARIANT_OPTION', `${missingSize.length} variant(s) have no option value (e.g. size).`, 'VARIANTS'));
    }
    if (variants.length > 100) {
      issues.push(warn('VARIANT_LIMIT', 'Shopify allows a maximum of 100 variants per product.', 'VARIANTS'));
    }
  }

  // --- Duplicate SKU across the catalog -----------------------------------------------------------
  if (context.usedSkus?.has(product.sku.toUpperCase())) {
    issues.push(err('DUPLICATE_SKU', `SKU ${product.sku} is used by another product.`, 'BASIC'));
  }

  // Two definitions can carry the same label (e.g. `care` and `care_instructions`);
  // collapse repeats so the issue list reads as a checklist, not a stutter.
  const seenMessages = new Set<string>();
  const uniqueIssues = issues.filter((issue) => {
    const key = `${issue.severity}:${issue.message}`;
    if (seenMessages.has(key)) return false;
    seenMessages.add(key);
    return true;
  });

  const errors = uniqueIssues.filter((i) => i.severity === 'ERROR');
  const warnings = uniqueIssues.filter((i) => i.severity === 'WARNING');
  const state: ReadinessState = errors.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'WARNINGS' : 'READY';

  // Score: start from completeness, then subtract for unresolved export issues.
  const penalty = errors.length * 8 + warnings.length * 2;
  const score = Math.max(0, Math.min(100, completeness.score - penalty));

  return { state, score, issues: uniqueIssues, errors, warnings };
}

export interface CatalogDuplicateReport {
  duplicateSkus: string[];
  duplicateHandles: string[];
  similarNames: Array<{ a: string; b: string; skuA: string; skuB: string }>;
}

/** Cross-product duplicate detection (spec §40). */
export function detectCatalogDuplicates(products: Array<{ sku: string; name: string | null; handle: string | null }>): CatalogDuplicateReport {
  const skuSeen = new Map<string, number>();
  const handleSeen = new Map<string, number>();
  for (const product of products) {
    if (product.sku) skuSeen.set(product.sku.toUpperCase(), (skuSeen.get(product.sku.toUpperCase()) ?? 0) + 1);
    if (product.handle) handleSeen.set(product.handle.toLowerCase(), (handleSeen.get(product.handle.toLowerCase()) ?? 0) + 1);
  }
  const duplicateSkus = [...skuSeen.entries()].filter(([, count]) => count > 1).map(([sku]) => sku);
  const duplicateHandles = [...handleSeen.entries()].filter(([, count]) => count > 1).map(([handle]) => handle);

  const similarNames: CatalogDuplicateReport['similarNames'] = [];
  const named = products.filter((p) => p.name && p.name.trim().length > 3);
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      const a = named[i].name as string;
      const b = named[j].name as string;
      if (normalizeName(a) === normalizeName(b) && a !== b) {
        similarNames.push({ a, b, skuA: named[i].sku, skuB: named[j].sku });
      }
    }
  }
  return { duplicateSkus, duplicateHandles, similarNames };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .sort()
    .join(' ');
}

export function describeProductRow(product: ProductRow): string {
  return product.name ? `${product.name} (${product.sku})` : product.sku;
}
