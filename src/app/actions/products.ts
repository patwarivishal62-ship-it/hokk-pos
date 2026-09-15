'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission, requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { all, run, parseJson } from '@/lib/db';
import { nowIso } from '@/lib/id';
import { logAudit } from '@/lib/audit';
import { getSetting } from '@/lib/settings';
import {
  archiveProduct,
  createProduct,
  deleteProduct,
  getProduct,
  recomputeAllProducts,
  recomputeProduct,
  setAttributeValues,
  setProductCollections,
  setProductStatus,
  updateProduct,
  EDITABLE_PRODUCT_COLUMNS,
} from '@/lib/products';
import { canTransition } from '@/lib/workflow';
import { slugify } from '@/lib/handle';
import { STATUS_LABELS, type ProductStatus, type TaskType } from '@/lib/types';

const NUMBER_COLUMNS = new Set([
  'price', 'compare_at_price', 'cost_price', 'weight', 'saree_length', 'saree_width',
  'blouse_length', 'inventory_qty',
]);
const BOOL_COLUMNS = new Set([
  'taxable', 'discount_eligible', 'track_inventory', 'requires_shipping', 'published', 'handle_locked', 'blouse_included',
]);
const JSON_LIST_COLUMNS = new Set(['tags', 'details']);

/**
 * Reads a product form into a patch. Only keys present in the submission are
 * touched, so a tab can save its own slice without wiping other sections.
 */
function readProductForm(formData: FormData): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE_PRODUCT_COLUMNS) {
    if (!formData.has(key)) continue;
    const raw = formData.get(key);
    if (JSON_LIST_COLUMNS.has(key)) {
      const text = typeof raw === 'string' ? raw : '';
      // Accept either a JSON array or newline/comma separated text.
      const trimmed = text.trim();
      if (trimmed.startsWith('[')) {
        patch[key] = JSON.stringify(parseJson<string[]>(trimmed, []).filter(Boolean));
      } else {
        patch[key] = JSON.stringify(
          text
            .split(/[\n,]/)
            .map((part) => part.trim())
            .filter(Boolean),
        );
      }
      continue;
    }
    if (BOOL_COLUMNS.has(key)) {
      patch[key] = raw === 'on' || raw === '1' || raw === 'true' ? 1 : 0;
      continue;
    }
    if (NUMBER_COLUMNS.has(key)) {
      const text = typeof raw === 'string' ? raw.trim() : '';
      patch[key] = text === '' ? null : Number(text);
      continue;
    }
    if (key === 'measurements') continue; // handled separately
    const text = typeof raw === 'string' ? raw.trim() : '';
    patch[key] = text === '' ? null : text;
  }
  if (formData.has('measurements')) {
    patch.measurements = formData.get('measurements');
  }
  return patch;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

export async function createProductAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.create');
    const product = createProduct(
      {
        name: String(formData.get('name') ?? '') || null,
        categoryId: String(formData.get('category_id') ?? '') || null,
        subcategoryId: String(formData.get('subcategory_id') ?? '') || null,
        handloomCultureId: String(formData.get('handloom_culture_id') ?? '') || null,
        internalReference: String(formData.get('internal_reference') ?? '') || null,
        productTypeLabel: String(formData.get('product_type_label') ?? '') || null,
        assigneeId: String(formData.get('assignee_id') ?? '') || null,
        price: formData.get('price') ? Number(formData.get('price')) : null,
        sku: hasPermission(user.permissions, 'product.sku.edit') ? String(formData.get('sku') ?? '') || null : null,
      },
      user.id,
    );
    revalidatePath('/products');
    revalidatePath('/dashboard');
    redirect(`/products/${product.id}`);
  } catch (error) {
    if ((error as Error).message?.startsWith('NEXT_REDIRECT')) throw error;
    return fail((error as Error).message);
  }
}

/**
 * Reads `product_id` from the form data rather than taking it as an argument, so
 * the action can be handed straight to a client component. Next.js only allows
 * functions marked `'use server'` to cross that boundary — an inline closure
 * wrapper would throw at render time.
 */
export async function updateProductAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.edit');
    const productId = String(formData.get('product_id') ?? '');
    if (!productId) return { ok: false, error: 'Missing product_id.' };
    const patch = readProductForm(formData);
    // Only Super Admin / product.sku.edit holders may change the identifier.
    if (patch.sku !== undefined && !hasPermission(user.permissions, 'product.sku.edit')) delete patch.sku;
    if (Object.keys(patch).length === 0) return { ok: true, message: 'Nothing to save.' };
    updateProduct(productId, patch, user.id);
    revalidatePath('/products');
    revalidatePath(`/products/${productId}`);
    revalidatePath('/dashboard');
    return { ok: true, message: 'Saved.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function saveAttributesAction(productId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.edit');
    const values: Array<{ fieldId: string; value: string; isMissing?: boolean; note?: string | null }> = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('attr:')) continue;
      const fieldId = key.slice(5);
      const missing = formData.get(`${key}:missing`);
      values.push({
        fieldId,
        value: typeof value === 'string' ? value : '',
        isMissing: missing === 'on' || missing === '1',
        note: typeof formData.get(`${key}:note`) === 'string' ? String(formData.get(`${key}:note`)) : null,
      });
    }
    setAttributeValues(productId, values, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/products');
    revalidatePath('/dashboard');
    return { ok: true, message: 'Saved.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function changeStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.status.change');
    const productId = String(formData.get('product_id') ?? '');
    const status = String(formData.get('status') ?? '') as ProductStatus;
    const comment = String(formData.get('comment') ?? '').trim();
    const product = getProduct(productId);
    if (!product) return fail('Product not found.');

    const check = canTransition(product.status, status, {
      readinessState: product.readiness_state,
      hasComment: Boolean(comment),
      permissions: user.permissions,
    });
    if (!check.allowed) return fail(check.reason ?? 'That transition is not allowed.');

    setProductStatus(productId, status, user.id, comment ? { comment } : {});
    revalidatePath(`/products/${productId}`);
    revalidatePath('/products');
    revalidatePath('/dashboard');
    return { ok: true, message: `Status set to ${STATUS_LABELS[status] ?? status}.` };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function reviewAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const decision = String(formData.get('decision') ?? '');
    const permission =
      decision === 'APPROVED' ? 'product.approve' : decision === 'REJECTED' || decision === 'CHANGES_REQUESTED' ? 'product.reject' : 'product.review';
    const user = await requirePermission(permission);
    const productId = String(formData.get('product_id') ?? '');
    const comment = String(formData.get('comment') ?? '').trim();
    if (decision !== 'APPROVED' && !comment) return fail('A reason is required when requesting changes or rejecting.');

    const checklist: Record<string, boolean> = {};
    for (const key of ['information', 'images', 'measurements', 'content', 'seo', 'pricing', 'collections']) {
      checklist[key] = formData.get(`check_${key}`) === 'on';
    }
    const product = getProduct(productId);
    if (!product) return fail('Product not found.');

    const nextStatus: ProductStatus =
      decision === 'APPROVED' ? 'SHOPIFY_READY' : decision === 'REJECTED' ? 'REJECTED' : 'CHANGES_REQUESTED';
    const check = canTransition(product.status, nextStatus, {
      readinessState: product.readiness_state,
      hasComment: Boolean(comment),
      permissions: user.permissions,
    });
    // Approving from any review stage is allowed by the review flow, so fall
    // back to a direct status write when the product is already past the gate.
    if (!check.allowed && decision !== 'APPROVED') return fail(check.reason ?? 'Transition not allowed.');

    setProductStatus(productId, nextStatus, user.id, { comment, decision, checklist });
    revalidatePath(`/products/${productId}`);
    revalidatePath('/products');
    revalidatePath('/dashboard');
    return { ok: true, message: decision === 'APPROVED' ? 'Product approved.' : 'Decision recorded.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function archiveAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.archive');
    const productId = String(formData.get('product_id') ?? '');
    const archived = String(formData.get('archived') ?? '1') === '1';
    archiveProduct(productId, archived, user.id);
    revalidatePath('/products');
    revalidatePath(`/products/${productId}`);
    revalidatePath('/dashboard');
    return { ok: true, message: archived ? 'Archived.' : 'Restored.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function deleteProductAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.delete');
    const productId = String(formData.get('product_id') ?? '');
    deleteProduct(productId, user.id);
    revalidatePath('/products');
    revalidatePath('/dashboard');
    redirect('/products');
  } catch (error) {
    if ((error as Error).message?.startsWith('NEXT_REDIRECT')) throw error;
    return fail((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Bulk operations (spec §23)
// ---------------------------------------------------------------------------

export async function bulkAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.bulk');
    const ids = String(formData.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) return fail('Select at least one product.');
    const action = String(formData.get('bulk') ?? '');
    const stamp = nowIso();

    const applyToAll = (sql: string, params: unknown[], label: string) => {
      for (const id of ids) {
        run(sql, [...params, id]);
        logAudit({
          entityType: 'PRODUCT',
          entityId: id,
          entityLabel: getProduct(id)?.sku ?? id,
          action: 'BULK_UPDATE',
          changes: [{ field: 'bulk', label, oldValue: null, newValue: String(formData.get('value') ?? '') }],
          userId: user.id,
        });
      }
    };

    switch (action) {
      case 'status': {
        const status = String(formData.get('value') ?? '') as ProductStatus;
        if (!STATUS_LABELS[status]) return fail('Unknown status.');
        for (const id of ids) setProductStatus(id, status, user.id);
        break;
      }
      case 'assign':
        applyToAll('UPDATE product SET assignee_id = ?, modified_by_id = ?, updated_at = ? WHERE id = ?',
          [String(formData.get('value') ?? '') || null, user.id, stamp], 'Assigned to');
        break;
      case 'category':
        applyToAll('UPDATE product SET category_id = ?, modified_by_id = ?, updated_at = ? WHERE id = ?',
          [String(formData.get('value') ?? '') || null, user.id, stamp], 'Category');
        break;
      case 'culture':
        applyToAll('UPDATE product SET handloom_culture_id = ?, modified_by_id = ?, updated_at = ? WHERE id = ?',
          [String(formData.get('value') ?? '') || null, user.id, stamp], 'Handloom culture');
        break;
      case 'collection': {
        const collectionId = String(formData.get('value') ?? '');
        if (!collectionId) return fail('Choose a collection.');
        for (const id of ids) {
          const existing = all<{ collection_id: string }>(
            'SELECT collection_id FROM product_collection WHERE product_id = ?',
            [id],
          ).map((row) => row.collection_id);
          setProductCollections(id, [...new Set([...existing, collectionId])], user.id);
        }
        break;
      }
      case 'tags': {
        const extra = String(formData.get('value') ?? '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
        for (const id of ids) {
          const product = getProduct(id);
          if (!product) continue;
          const current = parseJson<string[]>(product.tags, []);
          const merged = [...new Set([...current, ...extra])];
          updateProduct(id, { tags: JSON.stringify(merged) }, user.id);
        }
        break;
      }
      case 'archive':
        for (const id of ids) archiveProduct(id, true, user.id);
        break;
      case 'request_review':
        for (const id of ids) setProductStatus(id, 'CONTENT_REVIEW', user.id);
        break;
      case 'field': {
        const field = String(formData.get('field') ?? '');
        if (!EDITABLE_PRODUCT_COLUMNS.includes(field)) return fail('That field cannot be bulk updated.');
        const value = String(formData.get('value') ?? '') || null;
        applyToAll(`UPDATE product SET ${field} = ?, modified_by_id = ?, updated_at = ? WHERE id = ?`,
          [value, user.id, stamp], field);
        break;
      }
      case 'recompute':
        for (const id of ids) recomputeProduct(id, user.id);
        break;
      default:
        return fail('Unknown bulk action.');
    }

    revalidatePath('/products');
    revalidatePath('/dashboard');
    return { ok: true, message: `Applied to ${ids.length} product${ids.length === 1 ? '' : 's'}.` };
  } catch (error) {
    return fail((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Variants (spec §14)
// ---------------------------------------------------------------------------

export async function saveVariantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.edit');
    const productId = String(formData.get('product_id') ?? '');
    const variantId = String(formData.get('variant_id') ?? '');
    const product = getProduct(productId);
    if (!product) return fail('Product not found.');
    const sku = String(formData.get('sku') ?? '').trim().toUpperCase();
    if (!sku) return fail('A variant SKU is required.');
    const existing = all<{ id: string; sku: string }>('SELECT id, sku FROM variant');
    if (existing.some((v) => v.sku.toUpperCase() === sku && v.id !== variantId)) {
      return fail(`Variant SKU ${sku} is already used.`);
    }
    const stamp = nowIso();
    const values = {
      sku,
      title: String(formData.get('title') ?? '') || null,
      position: Number(formData.get('position') ?? 1) || 1,
      option1_name: String(formData.get('option1_name') ?? 'Title') || 'Title',
      option1_value: String(formData.get('option1_value') ?? 'Default Title') || 'Default Title',
      option2_name: String(formData.get('option2_name') ?? '') || null,
      option2_value: String(formData.get('option2_value') ?? '') || null,
      option3_name: String(formData.get('option3_name') ?? '') || null,
      option3_value: String(formData.get('option3_value') ?? '') || null,
      price: formData.get('price') === '' ? null : Number(formData.get('price')),
      compare_at_price: formData.get('compare_at_price') === '' ? null : Number(formData.get('compare_at_price')),
      cost_price: formData.get('cost_price') === '' ? null : Number(formData.get('cost_price')),
      inventory_qty: Number(formData.get('inventory_qty') ?? 0) || 0,
      weight: formData.get('weight') === '' ? null : Number(formData.get('weight')),
      weight_unit: String(formData.get('weight_unit') ?? (getSetting('units.weight') || 'g')),
      barcode: String(formData.get('barcode') ?? '') || null,
      taxable: formData.get('taxable') === 'on' ? 1 : 0,
      requires_shipping: formData.get('requires_shipping') === 'on' ? 1 : 0,
      track_inventory: formData.get('track_inventory') === 'on' ? 1 : 0,
      inventory_policy: String(formData.get('inventory_policy') ?? 'deny'),
      image_url: String(formData.get('image_url') ?? '') || null,
    };
    if (typeof values.price === 'number' && values.price < 0) return fail('Price cannot be negative.');

    if (variantId) {
      const sets = Object.keys(values).map((key) => `${key} = ?`).join(', ');
      run(`UPDATE variant SET ${sets}, updated_at = ? WHERE id = ?`, [...Object.values(values), stamp, variantId]);
    } else {
      const { cuid } = await import('@/lib/id');
      run(
        `INSERT INTO variant (id, product_id, ${Object.keys(values).join(', ')}, inventory_tracker, created_at, updated_at)
         VALUES (?, ?, ${Object.keys(values).map(() => '?').join(', ')}, ?, ?, ?)`,
        [cuid(), productId, ...Object.values(values), product.inventory_tracker, stamp, stamp],
      );
    }
    run('UPDATE product SET modified_by_id = ?, updated_at = ? WHERE id = ?', [user.id, stamp, productId]);
    logAudit({
      entityType: 'PRODUCT',
      entityId: productId,
      entityLabel: product.sku,
      action: variantId ? 'UPDATE' : 'CREATE',
      changes: [{ field: 'variants', label: `Variant ${sku}`, oldValue: null, newValue: sku }],
      userId: user.id,
    });
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/products');
    return { ok: true, message: 'Variant saved.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function deleteVariantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.edit');
    const variantId = String(formData.get('variant_id') ?? '');
    const productId = String(formData.get('product_id') ?? '');
    run('DELETE FROM variant WHERE id = ? AND product_id = ?', [variantId, productId]);
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    return { ok: true, message: 'Variant removed.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Naming workflow (spec §9)
// ---------------------------------------------------------------------------

export async function proposeNameAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('name.propose');
    const productId = String(formData.get('product_id') ?? '');
    const proposedName = String(formData.get('proposed_name') ?? '').trim();
    if (!proposedName) return fail('Enter a proposed name.');
    const { cuid } = await import('@/lib/id');
    run(
      `INSERT INTO name_proposal (id, product_id, proposed_name, rationale, status, proposed_by_id, created_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
      [cuid(), productId, proposedName, String(formData.get('rationale') ?? '') || null, user.id, nowIso()],
    );
    run('UPDATE product SET name_status = ?, updated_at = ? WHERE id = ?', ['NAME_PROPOSED', nowIso(), productId]);
    logAudit({
      entityType: 'PRODUCT',
      entityId: productId,
      entityLabel: getProduct(productId)?.sku ?? productId,
      action: 'NAME_PROPOSED',
      changes: [{ field: 'name', label: 'Proposed name', oldValue: null, newValue: proposedName }],
      userId: user.id,
    });
    revalidatePath(`/products/${productId}`);
    return { ok: true, message: 'Name proposed.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function decideNameAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('name.approve');
    const proposalId = String(formData.get('proposal_id') ?? '');
    const productId = String(formData.get('product_id') ?? '');
    const decision = String(formData.get('decision') ?? '');
    const note = String(formData.get('decision_note') ?? '') || null;
    const proposal = all<{ proposed_name: string }>('SELECT proposed_name FROM name_proposal WHERE id = ?', [proposalId])[0];
    if (!proposal) return fail('Proposal not found.');
    const stamp = nowIso();
    run(
      `UPDATE name_proposal SET status = ?, decided_by_id = ?, decided_at = ?, decision_note = ? WHERE id = ?`,
      [decision === 'approve' ? 'APPROVED' : 'REJECTED', user.id, stamp, note, proposalId],
    );
    if (decision === 'approve') {
      updateProduct(productId, { name: proposal.proposed_name, name_status: 'NAME_APPROVED' }, user.id, {
        action: 'NAME_APPROVED',
        reason: 'Name approved',
      });
    }
    revalidatePath(`/products/${productId}`);
    revalidatePath('/products');
    return { ok: true, message: decision === 'approve' ? 'Name approved.' : 'Proposal rejected.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Gaps — "MISSING — INFORMATION REQUIRED" (spec §10)
// ---------------------------------------------------------------------------

export async function setGapAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.edit');
    const productId = String(formData.get('product_id') ?? '');
    const fieldKey = String(formData.get('field_key') ?? '');
    const label = String(formData.get('label') ?? fieldKey);
    const section = String(formData.get('section') ?? 'GENERAL');
    const severity = String(formData.get('severity') ?? 'REQUIRED');
    const note = String(formData.get('note') ?? '') || null;
    const open = String(formData.get('open') ?? '1') === '1';
    const { cuid } = await import('@/lib/id');
    const stamp = nowIso();
    run(
      `INSERT INTO product_gap (id, product_id, field_key, label, section, severity, note, status, created_by_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id, field_key) DO UPDATE SET
         status = excluded.status, note = excluded.note, severity = excluded.severity, updated_at = excluded.updated_at`,
      [cuid(), productId, fieldKey, label, section, severity, note, open ? 'OPEN' : 'RESOLVED', user.id, stamp, stamp],
    );
    if (!open) run('UPDATE product_gap SET resolved_at = ? WHERE product_id = ? AND field_key = ?', [stamp, productId, fieldKey]);
    logAudit({
      entityType: 'PRODUCT',
      entityId: productId,
      entityLabel: getProduct(productId)?.sku ?? productId,
      action: open ? 'GAP_OPENED' : 'GAP_RESOLVED',
      changes: [{ field: fieldKey, label, oldValue: null, newValue: open ? 'MISSING — INFORMATION REQUIRED' : 'Resolved' }],
      userId: user.id,
    });
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/products');
    revalidatePath('/dashboard');
    return { ok: true, message: open ? 'Marked as missing.' : 'Gap resolved.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Collections on a product
// ---------------------------------------------------------------------------

export async function setCollectionsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.edit');
    const productId = String(formData.get('product_id') ?? '');
    const ids = String(formData.get('collection_ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    setProductCollections(productId, ids, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/products');
    return { ok: true, message: 'Collections updated.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Assignments (spec §26)
// ---------------------------------------------------------------------------

export async function assignAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.assign');
    const productId = String(formData.get('product_id') ?? '');
    const assigneeId = String(formData.get('assignee_id') ?? '');
    const taskType = String(formData.get('task_type') ?? '') as TaskType;
    const stamp = nowIso();
    if (taskType) {
      const { cuid } = await import('@/lib/id');
      run(
        `INSERT INTO assignment (id, product_id, user_id, task_type, status, note, due_at, created_by_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
         ON CONFLICT(product_id, user_id, task_type) DO UPDATE SET
           status = 'OPEN', note = excluded.note, due_at = excluded.due_at, updated_at = excluded.updated_at`,
        [
          cuid(),
          productId,
          assigneeId,
          taskType,
          String(formData.get('note') ?? '') || null,
          String(formData.get('due_at') ?? '') || null,
          user.id,
          stamp,
          stamp,
        ],
      );
    } else {
      run('UPDATE product SET assignee_id = ?, modified_by_id = ?, updated_at = ? WHERE id = ?', [
        assigneeId || null,
        user.id,
        stamp,
        productId,
      ]);
    }
    logAudit({
      entityType: 'PRODUCT',
      entityId: productId,
      entityLabel: getProduct(productId)?.sku ?? productId,
      action: 'ASSIGN',
      changes: [{ field: 'assignee_id', label: taskType ? `${taskType} assignment` : 'Assigned to', oldValue: null, newValue: assigneeId }],
      userId: user.id,
    });
    revalidatePath(`/products/${productId}`);
    revalidatePath('/products');
    revalidatePath('/dashboard');
    return { ok: true, message: 'Assignment saved.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function completeAssignmentAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const assignmentId = String(formData.get('assignment_id') ?? '');
    run(`UPDATE assignment SET status = 'DONE', completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [
      nowIso(),
      nowIso(),
      assignmentId,
      user.id,
    ]);
    revalidatePath('/dashboard');
    revalidatePath('/products');
    return { ok: true, message: 'Task completed.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Comments (spec §25)
// ---------------------------------------------------------------------------

export async function addCommentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('comment.create');
    const productId = String(formData.get('product_id') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return fail('Write a comment first.');
    const mentions = [...body.matchAll(/@([\w.+-]+)/g)].map((m) => m[1]);
    const mentionIds = mentions.length
      ? all<{ id: string }>(
          `SELECT id FROM "user" WHERE ${mentions.map(() => 'lower(email) LIKE ? OR lower(name) LIKE ?').join(' OR ')}`,
          mentions.flatMap((mention) => [`${mention.toLowerCase()}%`, `%${mention.toLowerCase()}%`]),
        ).map((row) => row.id)
      : [];
    const { cuid } = await import('@/lib/id');
    run(
      `INSERT INTO comment (id, product_id, user_id, body, mentions, is_resolved, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [cuid(), productId, user.id, body, JSON.stringify(mentionIds), nowIso(), nowIso()],
    );
    revalidatePath(`/products/${productId}`);
    return { ok: true, message: 'Comment added.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function resolveCommentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const commentId = String(formData.get('comment_id') ?? '');
    const productId = String(formData.get('product_id') ?? '');
    run('UPDATE comment SET is_resolved = 1 - is_resolved, updated_at = ? WHERE id = ? AND user_id = ?', [
      nowIso(),
      commentId,
      user.id,
    ]);
    revalidatePath(`/products/${productId}`);
    return { ok: true, message: 'Comment updated.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Handle override (spec §31)
// ---------------------------------------------------------------------------

export async function setHandleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.edit');
    const productId = String(formData.get('product_id') ?? '');
    const handle = slugify(String(formData.get('handle') ?? ''));
    const lock = String(formData.get('lock') ?? '0') === '1';
    if (!handle) return fail('Enter a handle.');
    const clash = all<{ id: string; sku: string }>('SELECT id, sku FROM product WHERE handle = ? AND id != ?', [handle, productId]);
    if (clash.length > 0) return fail(`That handle is already used by ${clash[0].sku}.`);
    updateProduct(productId, { handle, handle_locked: lock ? 1 : 0 }, user.id, { action: 'HANDLE_OVERRIDE' });
    revalidatePath(`/products/${productId}`);
    return { ok: true, message: 'Handle updated.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function recomputeAction(): Promise<ActionResult> {
  try {
    const user = await requirePermission('product.edit');
    const count = recomputeAllProducts();
    revalidatePath('/products');
    revalidatePath('/dashboard');
    return { ok: true, message: `Recomputed ${count} products.` };
  } catch (error) {
    return fail((error as Error).message);
  }
}
