/**
 * Integration tests for the product server actions.
 *
 * `src/app/actions/products.ts` is the largest action module in the app (20
 * actions) and the one carrying the most business rules: workflow gating, the
 * naming workflow, review decisions, variants, gaps, assignments and comments.
 * It is also pure hand-written SQL against a schema whose column names the type
 * system cannot check, so a typo compiles, builds, and only fails when a user
 * clicks the button.
 *
 * These tests run the real actions against a real SQLite file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-products-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'products.db')}`;
process.env.SESSION_SECRET = 'test-secret-value-for-hokk-pos-0123456789';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const authState = vi.hoisted(() => ({
  user: null as null | { id: string; permissions: string[] },
}));

function fakeUser() {
  return {
    id: authState.user!.id,
    email: 'admin@test.local',
    name: 'Test Admin',
    roleKey: 'SUPER_ADMIN',
    roleName: 'Super Admin',
    jobTitle: null,
    isActive: true,
    mustChangePassword: false,
    permissions: authState.user!.permissions,
  };
}

vi.mock('@/lib/auth', () => ({
  requireUser: async () => {
    if (!authState.user) throw new Error('not signed in');
    return fakeUser();
  },
  requirePermission: async (permission: string) => {
    if (!authState.user) throw new Error('not signed in');
    const allowed =
      authState.user.permissions.includes('*') || authState.user.permissions.includes(permission);
    if (!allowed) throw new Error(`You do not have permission to ${permission}.`);
    return fakeUser();
  },
  userCan: (_user: unknown, _permission: string) => true,
}));

const { all, get, run } = await import('@/lib/db');
const { ensureSchema, seedSystemDefaults, createSuperAdmin } = await import('@/lib/bootstrap');
const { createProduct, updateProduct, recomputeProduct } = await import('@/lib/products');
const {
  changeStatusAction,
  reviewAction,
  proposeNameAction,
  decideNameAction,
  setHandleAction,
  saveVariantAction,
  deleteVariantAction,
  setGapAction,
  setCollectionsAction,
  assignAction,
  completeAssignmentAction,
  addCommentAction,
  resolveCommentAction,
  archiveAction,
  deleteProductAction,
  bulkAction,
  recomputeAction,
} = await import('@/app/actions/products');

function form(entries: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

let adminId = '';
let categoryId = '';
let cultureId = '';
let collectionId = '';

/** Creates a product in DRAFT and returns its id. */
function newProduct(name = 'Test Product'): string {
  return createProduct(
    { name, categoryId, handloomCultureId: cultureId, price: 1000 },
    adminId,
  ).id;
}

function productRow(id: string) {
  return get<Record<string, unknown>>('SELECT * FROM product WHERE id = ?', [id])!;
}

/** Walks a product forward through the pipeline to the given status. */
function forceStatus(id: string, status: string) {
  run('UPDATE product SET status = ? WHERE id = ?', [status, id]);
}

beforeEach(() => {
  authState.user = { id: adminId, permissions: ['*'] };
});

describe('product actions', () => {
  const setup = async () => {
    ensureSchema();
    seedSystemDefaults();
    const admin = createSuperAdmin(
      { email: 'admin@test.local', name: 'Test Admin', password: 'password-12345' },
      { allowWhenInitialized: true },
    );
    adminId = admin.id;
    authState.user = { id: adminId, permissions: ['*'] };

    // Column names verified against `PRAGMA table_info`: these tables use
    // `is_archived` + `sort_order`, not `is_active`.
    run(
      `INSERT INTO category (id, name, slug, sku_segment, template_key, sort_order, is_archived, created_at, updated_at)
       VALUES ('cat-1', 'Sarees', 'sarees', 'SAR', 'SAREE', 0, 0, '2026-01-01', '2026-01-01')`,
    );
    run(
      `INSERT INTO handloom_culture (id, name, slug, code, sort_order, is_archived, created_at, updated_at)
       VALUES ('cul-1', 'Zari Kota', 'zari-kota', 'ZK', 0, 0, '2026-01-01', '2026-01-01')`,
    );
    run(
      `INSERT INTO collection (id, name, slug, handle, kind, sort_order, is_archived, created_at, updated_at)
       VALUES ('col-1', 'Festive Edit', 'festive-edit', 'festive-edit', 'CUSTOMER', 0, 0, '2026-01-01', '2026-01-01')`,
    );
    categoryId = 'cat-1';
    cultureId = 'cul-1';
    collectionId = 'col-1';
  };

  it('boots a schema with the taxonomy fixtures in place', async () => {
    await setup();
    expect(get('SELECT id FROM category WHERE id = ?', [categoryId])).toBeTruthy();
    expect(get('SELECT id FROM handloom_culture WHERE id = ?', [cultureId])).toBeTruthy();
  });

  // --- workflow gating ---------------------------------------------------------

  it('changes status along a legal transition', async () => {
    const id = newProduct();
    const result = await changeStatusAction(null, form({ product_id: id, status: 'INFORMATION_REQUIRED' }));
    expect(result.ok).toBe(true);
    expect(productRow(id).status).toBe('INFORMATION_REQUIRED');
  });

  it('refuses an illegal transition instead of writing it', async () => {
    const id = newProduct();
    // DRAFT cannot jump straight to EXPORTED.
    const result = await changeStatusAction(null, form({ product_id: id, status: 'EXPORTED' }));
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(productRow(id).status).toBe('DRAFT');
  });

  it('requires a comment when requesting changes', async () => {
    const id = newProduct();
    forceStatus(id, 'CONTENT_REVIEW');
    const withoutComment = await changeStatusAction(null, form({ product_id: id, status: 'CHANGES_REQUESTED' }));
    expect(withoutComment.ok).toBe(false);
    expect(productRow(id).status).toBe('CONTENT_REVIEW');

    const withComment = await changeStatusAction(
      null,
      form({ product_id: id, status: 'CHANGES_REQUESTED', comment: 'Pallu shot is out of focus.' }),
    );
    expect(withComment.ok).toBe(true);
    expect(productRow(id).status).toBe('CHANGES_REQUESTED');
  });

  it('will not reach SHOPIFY_READY while readiness is BLOCKED', async () => {
    const id = newProduct();
    forceStatus(id, 'FOUNDER_APPROVAL');
    run('UPDATE product SET readiness_state = ? WHERE id = ?', ['BLOCKED', id]);

    const result = await changeStatusAction(null, form({ product_id: id, status: 'SHOPIFY_READY' }));
    expect(result.ok).toBe(false);
    expect(productRow(id).status).toBe('FOUNDER_APPROVAL');
  });

  it('reports a missing product rather than throwing', async () => {
    const result = await changeStatusAction(null, form({ product_id: 'nope', status: 'INFORMATION_REQUIRED' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  // --- review ------------------------------------------------------------------

  it('records an approval and moves the product to SHOPIFY_READY', async () => {
    const id = newProduct();
    forceStatus(id, 'FOUNDER_APPROVAL');
    run('UPDATE product SET readiness_state = ? WHERE id = ?', ['READY', id]);

    const result = await reviewAction(
      null,
      form({ product_id: id, decision: 'APPROVED', check_information: 'on', check_images: 'on' }),
    );
    expect(result.ok).toBe(true);
    expect(productRow(id).status).toBe('SHOPIFY_READY');
  });

  it('demands a reason before recording changes requested', async () => {
    const id = newProduct();
    forceStatus(id, 'INTERNAL_REVIEW');

    const noReason = await reviewAction(null, form({ product_id: id, decision: 'CHANGES_REQUESTED' }));
    expect(noReason.ok).toBe(false);
    expect(noReason.error).toMatch(/reason/i);
    expect(productRow(id).status).toBe('INTERNAL_REVIEW');
  });

  it('rejects a product and stores the review checklist', async () => {
    const id = newProduct();
    forceStatus(id, 'FOUNDER_APPROVAL');

    const result = await reviewAction(
      null,
      form({ product_id: id, decision: 'REJECTED', comment: 'Story is unverifiable.', check_pricing: 'on' }),
    );
    expect(result.ok).toBe(true);
    expect(productRow(id).status).toBe('REJECTED');

    const review = get<{ checklist: string }>(
      'SELECT checklist FROM product_review WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
      [id],
    );
    expect(review).toBeTruthy();
    expect(JSON.parse(review!.checklist)).toMatchObject({ pricing: true, seo: false });
  });

  // --- naming workflow ---------------------------------------------------------

  it('proposes a name without overwriting the product name', async () => {
    const id = newProduct('Original Name');
    const result = await proposeNameAction(
      null,
      form({ product_id: id, proposed_name: 'Chanderi Sunrise Drape', rationale: 'Matches the motif.' }),
    );
    expect(result.ok).toBe(true);
    expect(productRow(id).name).toBe('Original Name');
    expect(productRow(id).name_status).toBe('NAME_PROPOSED');

    const proposal = get<{ status: string; proposed_name: string }>(
      'SELECT status, proposed_name FROM name_proposal WHERE product_id = ?',
      [id],
    );
    expect(proposal).toMatchObject({ status: 'PENDING', proposed_name: 'Chanderi Sunrise Drape' });
  });

  it('refuses an empty proposed name', async () => {
    const id = newProduct();
    const result = await proposeNameAction(null, form({ product_id: id, proposed_name: '   ' }));
    expect(result.ok).toBe(false);
  });

  it('applies the proposed name only when the reviewer approves', async () => {
    const id = newProduct('Working Title');
    await proposeNameAction(null, form({ product_id: id, proposed_name: 'Banarasi Meadow' }));
    const proposalId = get<{ id: string }>('SELECT id FROM name_proposal WHERE product_id = ?', [id])!.id;

    const approved = await decideNameAction(
      null,
      form({ product_id: id, proposal_id: proposalId, decision: 'approve', decision_note: 'Good.' }),
    );
    expect(approved.ok).toBe(true);
    expect(productRow(id).name).toBe('Banarasi Meadow');
    expect(productRow(id).name_status).toBe('NAME_APPROVED');
    expect(get('SELECT status FROM name_proposal WHERE id = ?', [proposalId])!.status).toBe('APPROVED');
  });

  it('leaves the product name untouched when a proposal is rejected', async () => {
    const id = newProduct('Working Title');
    await proposeNameAction(null, form({ product_id: id, proposed_name: 'Rejected Idea' }));
    const proposalId = get<{ id: string }>('SELECT id FROM name_proposal WHERE product_id = ?', [id])!.id;

    const rejected = await decideNameAction(
      null,
      form({ product_id: id, proposal_id: proposalId, decision: 'reject' }),
    );
    expect(rejected.ok).toBe(true);
    expect(productRow(id).name).toBe('Working Title');
    expect(get('SELECT status FROM name_proposal WHERE id = ?', [proposalId])!.status).toBe('REJECTED');
  });

  it('reports a missing proposal', async () => {
    const result = await decideNameAction(null, form({ product_id: 'x', proposal_id: 'nope', decision: 'approve' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  // --- handle ------------------------------------------------------------------

  it('slugifies and locks an overridden handle', async () => {
    const id = newProduct();
    const result = await setHandleAction(
      null,
      form({ product_id: id, handle: 'Festive Zari Kota Saree!', lock: '1' }),
    );
    expect(result.ok).toBe(true);
    expect(productRow(id).handle).toBe('festive-zari-kota-saree');
    expect(productRow(id).handle_locked).toBe(1);
  });

  it('refuses a handle another product already owns', async () => {
    const a = newProduct('A');
    const b = newProduct('B');
    await setHandleAction(null, form({ product_id: a, handle: 'shared-handle' }));

    const clash = await setHandleAction(null, form({ product_id: b, handle: 'shared-handle' }));
    expect(clash.ok).toBe(false);
    expect(clash.error).toMatch(/already used/i);
    expect(productRow(b).handle).not.toBe('shared-handle');
  });

  it('rejects an empty handle', async () => {
    const id = newProduct();
    const result = await setHandleAction(null, form({ product_id: id, handle: '' }));
    expect(result.ok).toBe(false);
  });

  // --- variants ----------------------------------------------------------------

  it('creates a variant and refuses a duplicate variant SKU', async () => {
    const id = newProduct();
    // `createProduct` seeds a default variant carrying the product SKU, so the
    // product already has one variant before this action runs.
    expect(all('SELECT id FROM variant WHERE product_id = ?', [id])).toHaveLength(1);

    const created = await saveVariantAction(
      null,
      form({ product_id: id, sku: 'hokk-sar-zk-001-red', price: '1200', inventory_qty: '4', option1_name: 'Colour', option1_value: 'Red' }),
    );
    expect(created.ok).toBe(true);

    const variant = get<{ sku: string; price: number; inventory_qty: number }>(
      'SELECT sku, price, inventory_qty FROM variant WHERE product_id = ? AND sku = ?',
      [id, 'HOKK-SAR-ZK-001-RED'],
    );
    expect(variant).toMatchObject({ sku: 'HOKK-SAR-ZK-001-RED', inventory_qty: 4 });
    expect(Number(variant?.price)).toBe(1200);
    expect(all('SELECT id FROM variant WHERE product_id = ?', [id])).toHaveLength(2);

    const duplicate = await saveVariantAction(null, form({ product_id: id, sku: 'HOKK-SAR-ZK-001-RED' }));
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toMatch(/already used/i);
    expect(all('SELECT id FROM variant WHERE product_id = ?', [id])).toHaveLength(2);
  });

  it('refuses a variant with no SKU', async () => {
    const id = newProduct();
    const result = await saveVariantAction(null, form({ product_id: id, sku: '  ' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sku/i);
  });

  it('deletes a variant scoped to its own product', async () => {
    const id = newProduct();
    await saveVariantAction(null, form({ product_id: id, sku: 'del-me' }));
    const variantId = get<{ id: string }>('SELECT id FROM variant WHERE product_id = ? AND sku = ?', [id, 'DEL-ME'])!.id;

    // Wrong product id must not delete it.
    await deleteVariantAction(null, form({ product_id: 'other-product', variant_id: variantId }));
    expect(get('SELECT id FROM variant WHERE id = ?', [variantId])).toBeTruthy();

    const result = await deleteVariantAction(null, form({ product_id: id, variant_id: variantId }));
    expect(result.ok).toBe(true);
    expect(get('SELECT id FROM variant WHERE id = ?', [variantId])).toBeUndefined();
  });

  // --- gaps --------------------------------------------------------------------

  it('opens a gap, counts it against completeness, then resolves it', async () => {
    const id = newProduct();
    recomputeProduct(id, adminId);
    const before = Number(productRow(id).completeness_score);

    const opened = await setGapAction(
      null,
      form({ product_id: id, field_key: 'weaver_story', label: 'Weaver story', section: 'HANDLOOM', open: '1' }),
    );
    expect(opened.ok).toBe(true);
    const gap = get<{ status: string }>('SELECT status FROM product_gap WHERE product_id = ? AND field_key = ?', [
      id,
      'weaver_story',
    ]);
    expect(gap?.status).toBe('OPEN');
    expect(Number(productRow(id).completeness_score)).toBeLessThan(before);

    const resolved = await setGapAction(
      null,
      form({ product_id: id, field_key: 'weaver_story', label: 'Weaver story', open: '0' }),
    );
    expect(resolved.ok).toBe(true);
    // Upsert must not create a second row for the same field.
    expect(all('SELECT id FROM product_gap WHERE product_id = ? AND field_key = ?', [id, 'weaver_story'])).toHaveLength(1);
    expect(
      get<{ status: string; resolved_at: string | null }>(
        'SELECT status, resolved_at FROM product_gap WHERE product_id = ? AND field_key = ?',
        [id, 'weaver_story'],
      ),
    ).toMatchObject({ status: 'RESOLVED' });
  });

  // --- collections -------------------------------------------------------------

  it('sets and then clears the collections on a product', async () => {
    const id = newProduct();
    const set = await setCollectionsAction(null, form({ product_id: id, collection_ids: collectionId }));
    expect(set.ok).toBe(true);
    expect(all('SELECT collection_id FROM product_collection WHERE product_id = ?', [id])).toHaveLength(1);

    const cleared = await setCollectionsAction(null, form({ product_id: id, collection_ids: '' }));
    expect(cleared.ok).toBe(true);
    expect(all('SELECT collection_id FROM product_collection WHERE product_id = ?', [id])).toHaveLength(0);
  });

  // --- assignments -------------------------------------------------------------

  it('creates a discipline task assignment and completes it', async () => {
    const id = newProduct();
    const assigned = await assignAction(
      null,
      form({ product_id: id, assignee_id: adminId, task_type: 'PHOTOGRAPHY', note: 'Shoot the pallu.' }),
    );
    expect(assigned.ok).toBe(true);

    const assignment = get<{ task_type: string; status: string; user_id: string }>(
      'SELECT task_type, status, user_id FROM assignment WHERE product_id = ?',
      [id],
    );
    expect(assignment).toMatchObject({ task_type: 'PHOTOGRAPHY', status: 'OPEN', user_id: adminId });

    const assignmentId = get<{ id: string }>('SELECT id FROM assignment WHERE product_id = ?', [id])!.id;
    const done = await completeAssignmentAction(form({ assignment_id: assignmentId }));
    expect(done.ok).toBe(true);
    expect(get<{ status: string }>('SELECT status FROM assignment WHERE product_id = ?', [id])?.status).toBe('DONE');
  });

  it('re-opening the same discipline task upserts instead of duplicating', async () => {
    const id = newProduct();
    await assignAction(null, form({ product_id: id, assignee_id: adminId, task_type: 'CONTENT' }));
    await assignAction(null, form({ product_id: id, assignee_id: adminId, task_type: 'CONTENT', note: 'Second time' }));
    expect(all('SELECT id FROM assignment WHERE product_id = ?', [id])).toHaveLength(1);
    expect(get<{ note: string }>('SELECT note FROM assignment WHERE product_id = ?', [id])?.note).toBe('Second time');
  });

  it('sets the plain assignee when no task type is given', async () => {
    const id = newProduct();
    const result = await assignAction(null, form({ product_id: id, assignee_id: adminId }));
    expect(result.ok).toBe(true);
    expect(productRow(id).assignee_id).toBe(adminId);
    expect(all('SELECT id FROM assignment WHERE product_id = ?', [id])).toHaveLength(0);
  });

  // --- comments ----------------------------------------------------------------

  it('adds a comment and resolves @mentions to user ids', async () => {
    const id = newProduct();
    const result = await addCommentAction(
      null,
      form({ product_id: id, body: 'Please check this @admin@test.local before approval.' }),
    );
    expect(result.ok).toBe(true);

    const comment = get<{ body: string; mentions: string; is_resolved: number }>(
      'SELECT body, mentions, is_resolved FROM comment WHERE product_id = ?',
      [id],
    );
    expect(comment?.body).toContain('@admin@test.local');
    expect(comment?.is_resolved).toBe(0);
    expect(JSON.parse(comment!.mentions)).toContain(adminId);
  });

  it('refuses an empty comment', async () => {
    const id = newProduct();
    const result = await addCommentAction(null, form({ product_id: id, body: '   ' }));
    expect(result.ok).toBe(false);
  });

  it('toggles comment resolution and only for its own author', async () => {
    const id = newProduct();
    await addCommentAction(null, form({ product_id: id, body: 'First comment.' }));
    const commentId = get<{ id: string }>('SELECT id FROM comment WHERE product_id = ?', [id])!.id;

    await resolveCommentAction(null, form({ comment_id: commentId, product_id: id }));
    expect(get<{ is_resolved: number }>('SELECT is_resolved FROM comment WHERE id = ?', [commentId])?.is_resolved).toBe(1);

    // A different user cannot resolve someone else's comment: the UPDATE is
    // scoped by user_id, so nothing changes.
    authState.user = { id: 'someone-else', permissions: ['*'] };
    await resolveCommentAction(null, form({ comment_id: commentId, product_id: id }));
    expect(get<{ is_resolved: number }>('SELECT is_resolved FROM comment WHERE id = ?', [commentId])?.is_resolved).toBe(1);
    authState.user = { id: adminId, permissions: ['*'] };
  });

  // --- archive / delete --------------------------------------------------------

  it('archives and restores a product', async () => {
    const id = newProduct();
    const archived = await archiveAction(null, form({ product_id: id, archived: '1' }));
    expect(archived.ok).toBe(true);
    expect(productRow(id).is_archived).toBe(1);

    const restored = await archiveAction(null, form({ product_id: id, archived: '0' }));
    expect(restored.ok).toBe(true);
    expect(productRow(id).is_archived).toBe(0);
  });

  it('deletes a product and redirects to the list', async () => {
    const id = newProduct();
    await expect(deleteProductAction(form({ product_id: id }))).rejects.toThrow('NEXT_REDIRECT:/products');
    expect(get('SELECT id FROM product WHERE id = ?', [id])).toBeUndefined();
  });

  // --- bulk --------------------------------------------------------------------

  it('bulk-assigns a category to every selected product', async () => {
    const a = newProduct('Bulk A');
    const b = newProduct('Bulk B');
    run('UPDATE product SET category_id = NULL WHERE id IN (?, ?)', [a, b]);

    const result = await bulkAction(
      null,
      form({ ids: `${a},${b}`, bulk: 'category', value: categoryId }),
    );
    expect(result.ok).toBe(true);
    expect(productRow(a).category_id).toBe(categoryId);
    expect(productRow(b).category_id).toBe(categoryId);
  });

  it('bulk-changes status through the same status writer', async () => {
    const a = newProduct('Status A');
    const b = newProduct('Status B');
    const result = await bulkAction(null, form({ ids: `${a},${b}`, bulk: 'status', value: 'INFORMATION_REQUIRED' }));
    expect(result.ok).toBe(true);
    expect(productRow(a).status).toBe('INFORMATION_REQUIRED');
    expect(productRow(b).status).toBe('INFORMATION_REQUIRED');
  });

  it('refuses a bulk change with no selection or an unknown status', async () => {
    const id = newProduct();
    expect((await bulkAction(null, form({ ids: '', bulk: 'status', value: 'DRAFT' }))).ok).toBe(false);
    expect((await bulkAction(null, form({ ids: id, bulk: 'status', value: 'NOT_A_STATUS' }))).ok).toBe(false);
    expect(productRow(id).status).toBe('DRAFT');
  });

  // --- recompute ---------------------------------------------------------------

  it('recomputes every product and reports the count', async () => {
    newProduct('Recompute A');
    newProduct('Recompute B');
    const result = await recomputeAction();
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Recomputed \d+ products/);
    const n = Number((result.message ?? '').replace(/\D/g, ''));
    expect(n).toBe(all('SELECT id FROM product').length);
  });

  // --- permissions -------------------------------------------------------------

  it('blocks an action the acting user has no permission for', async () => {
    const id = newProduct();
    authState.user = { id: adminId, permissions: ['product.view'] };

    const result = await changeStatusAction(null, form({ product_id: id, status: 'INFORMATION_REQUIRED' }));
    expect(result.ok).toBe(false);
    expect(productRow(id).status).toBe('DRAFT');

    authState.user = { id: adminId, permissions: ['*'] };
  });

  it('writes audit entries for product mutations', async () => {
    const id = newProduct();
    await proposeNameAction(null, form({ product_id: id, proposed_name: 'Audited Name' }));
    const entry = get<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = ? AND action = 'NAME_PROPOSED' LIMIT 1",
      [id],
    );
    expect(entry?.action).toBe('NAME_PROPOSED');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
