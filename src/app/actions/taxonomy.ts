'use server';

import { revalidatePath } from 'next/cache';
import { all, get, run, transaction } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { requirePermission } from '@/lib/auth';
import { diffRecords, logAudit } from '@/lib/audit';
import { slugify } from '@/lib/handle';

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export interface CategoryForm {
  name: string;
  handle?: string | null;
  template_key: 'SAREE' | 'APPAREL' | 'GENERIC';
  shopify_category?: string | null;
  shopify_type?: string | null;
  description?: string | null;
}

export async function saveCategoryAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('taxonomy.category.manage');
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { ok: false, error: 'Name is required.' };
    const slug = String(formData.get('slug') ?? '').trim() || slugify(name);
    const duplicate = get<{ id: string }>('SELECT id FROM category WHERE slug = ? AND id != ?', [slug, id]);
    if (duplicate) return { ok: false, error: `Slug “${slug}” is already used by another category.` };

    const values = [
      name,
      slug,
      text(formData, 'sku_segment'),
      String(formData.get('template_key') ?? 'GENERIC'),
      text(formData, 'shopify_category'),
      text(formData, 'shopify_type'),
      text(formData, 'description'),
    ];

    if (id) {
      const before = get<Record<string, unknown>>('SELECT * FROM category WHERE id = ?', [id]);
      run(
        `UPDATE category SET name = ?, slug = ?, sku_segment = ?, template_key = ?, shopify_category = ?,
         shopify_type = ?, description = ?, updated_at = ? WHERE id = ?`,
        [...values, nowIso(), id],
      );
      logAudit({
        entityType: 'CATEGORY',
        entityId: id,
        entityLabel: name,
        action: 'EDIT',
        userId: user.id,
        changes: diffRecords(before, get<Record<string, unknown>>('SELECT * FROM category WHERE id = ?', [id])),
      });
      revalidatePath('/categories');
      return { ok: true, message: 'Category updated.' };
    }

    const newId = cuid();
    run(
      `INSERT INTO category (id, name, slug, sku_segment, template_key, shopify_category, shopify_type, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM category), ?, ?)`,
      [newId, ...values, nowIso(), nowIso()],
    );
    logAudit({ entityType: 'CATEGORY', entityId: newId, entityLabel: name, action: 'CREATE', userId: user.id });
    revalidatePath('/categories');
    revalidatePath('/products');
    return { ok: true, message: `Category “${name}” created.` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function archiveCategoryAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('taxonomy.category.manage');
    const id = String(formData.get('id') ?? '');
    const row = get<{ name: string; is_archived: number }>('SELECT name, is_archived FROM category WHERE id = ?', [id]);
    if (!row) return { ok: false, error: 'Category not found.' };
    const inUse = get<{ n: number }>('SELECT COUNT(*) AS n FROM product WHERE category_id = ? AND is_archived = 0', [id])?.n ?? 0;
    if (inUse > 0) return { ok: false, error: `${inUse} product(s) still use this category. Reassign them first.` };
    run('UPDATE category SET is_archived = ?, updated_at = ? WHERE id = ?', [row.is_archived ? 0 : 1, nowIso(), id]);
    logAudit({
      entityType: 'CATEGORY',
      entityId: id,
      entityLabel: row.name,
      action: row.is_archived ? 'RESTORE' : 'ARCHIVE',
      userId: user.id,
    });
    revalidatePath('/categories');
    return { ok: true, message: row.is_archived ? 'Category restored.' : 'Category archived.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function saveCultureAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('taxonomy.culture.manage');
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { ok: false, error: 'Name is required.' };
    const code = String(formData.get('code') ?? '').trim().toUpperCase() || slugify(name).slice(0, 4).toUpperCase().replace(/-/g, '');
    const duplicate = get<{ id: string }>('SELECT id FROM handloom_culture WHERE code = ? AND id != ?', [code, id]);
    if (duplicate) return { ok: false, error: `Code “${code}” is already used. It appears in SKUs, so it must stay unique.` };

    const slug = String(formData.get('slug') ?? '').trim() || slugify(name);
    const values = [
      name,
      slug,
      code,
      text(formData, 'region'),
      text(formData, 'state'),
      text(formData, 'country') ?? 'India',
      text(formData, 'technique'),
      text(formData, 'typical_materials'),
      text(formData, 'typical_motifs'),
      text(formData, 'significance'),
      text(formData, 'history'),
      text(formData, 'description'),
    ];

    if (id) {
      const before = get<Record<string, unknown>>('SELECT * FROM handloom_culture WHERE id = ?', [id]);
      run(
        `UPDATE handloom_culture SET name=?, slug=?, code=?, region=?, state=?, country=?, technique=?,
         typical_materials=?, typical_motifs=?, significance=?, history=?, description=?, updated_at=?
         WHERE id = ?`,
        [...values, nowIso(), id],
      );
      logAudit({
        entityType: 'CULTURE',
        entityId: id,
        entityLabel: name,
        action: 'EDIT',
        userId: user.id,
        changes: diffRecords(before, get<Record<string, unknown>>('SELECT * FROM handloom_culture WHERE id = ?', [id])),
      });
      revalidatePath('/cultures');
      return { ok: true, message: 'Culture updated.' };
    }

    const newId = cuid();
    run(
      `INSERT INTO handloom_culture
        (id, name, slug, code, region, state, country, technique, typical_materials, typical_motifs,
         significance, history, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM handloom_culture), ?, ?)`,
      [newId, ...values, nowIso(), nowIso()],
    );
    logAudit({ entityType: 'CULTURE', entityId: newId, entityLabel: name, action: 'CREATE', userId: user.id });
    revalidatePath('/cultures');
    return { ok: true, message: `Handloom culture “${name}” created.` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function saveCollectionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('taxonomy.collection.manage');
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { ok: false, error: 'Name is required.' };
    const handle = String(formData.get('handle') ?? '').trim() || slugify(name);
    const slug = String(formData.get('slug') ?? '').trim() || handle;
    const kind = (String(formData.get('kind') ?? 'CUSTOMER') || 'CUSTOMER').toUpperCase();
    const duplicate = get<{ id: string }>('SELECT id FROM collection WHERE handle = ? AND id != ?', [handle, id]);
    if (duplicate) return { ok: false, error: `Handle “${handle}” is already used by another collection.` };

    const values = [name, slug, handle, kind, text(formData, 'description'), Number(formData.get('sort_order') ?? 0)];
    if (id) {
      run('UPDATE collection SET name=?, slug=?, handle=?, kind=?, description=?, sort_order=?, updated_at=? WHERE id = ?', [
        ...values,
        nowIso(),
        id,
      ]);
      logAudit({ entityType: 'COLLECTION', entityId: id, entityLabel: name, action: 'EDIT', userId: user.id });
      revalidatePath('/collections');
      return { ok: true, message: 'Collection updated.' };
    }
    const newId = cuid();
    run(
      'INSERT INTO collection (id, name, slug, handle, kind, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newId, ...values, nowIso(), nowIso()],
    );
    logAudit({ entityType: 'COLLECTION', entityId: newId, entityLabel: name, action: 'CREATE', userId: user.id });
    revalidatePath('/collections');
    return { ok: true, message: `Collection “${name}” created.` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function reorderCollectionsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('taxonomy.collection.manage');
    const order = String(formData.get('order') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    transaction(() => {
      order.forEach((id, index) => run('UPDATE collection SET sort_order = ? WHERE id = ?', [index + 1, id]));
    });
    logAudit({
      entityType: 'COLLECTION',
      entityId: 'reorder',
      entityLabel: 'Collection order',
      action: 'EDIT',
      userId: user.id,
      changes: [{ field: 'sort_order', label: 'Order', oldValue: null, newValue: order.join(', ') }],
    });
    revalidatePath('/collections');
    return { ok: true, message: 'Collection order saved.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function archiveCollectionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('taxonomy.collection.manage');
    const id = String(formData.get('id') ?? '');
    const row = get<{ name: string; is_archived: number }>('SELECT name, is_archived FROM collection WHERE id = ?', [id]);
    if (!row) return { ok: false, error: 'Collection not found.' };
    run('UPDATE collection SET is_archived = ?, updated_at = ? WHERE id = ?', [row.is_archived ? 0 : 1, nowIso(), id]);
    logAudit({
      entityType: 'COLLECTION',
      entityId: id,
      entityLabel: row.name,
      action: row.is_archived ? 'RESTORE' : 'ARCHIVE',
      userId: user.id,
    });
    revalidatePath('/collections');
    return { ok: true, message: row.is_archived ? 'Collection restored.' : 'Collection archived.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function saveSizeGuideAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('sizeguide.manage');
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { ok: false, error: 'Name is required.' };
    const unit = String(formData.get('unit') ?? 'cm');
    const appliesTo = String(formData.get('applies_to') ?? '');
    const columns = String(formData.get('columns') ?? '')
      .split('\n')
      .map((label) => label.trim())
      .filter(Boolean);
    const rowsRaw = String(formData.get('rows') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (columns.length === 0) return { ok: false, error: 'Add at least one measurement column.' };

    const guideId = id || cuid();
    transaction(() => {
      if (id) {
        run('UPDATE size_guide SET name = ?, unit = ?, applies_to = ?, updated_at = ? WHERE id = ?', [
          name,
          unit,
          appliesTo,
          nowIso(),
          id,
        ]);
        run('DELETE FROM size_guide_cell WHERE row_id IN (SELECT id FROM size_guide_row WHERE size_guide_id = ?)', [id]);
        run('DELETE FROM size_guide_row WHERE size_guide_id = ?', [id]);
        run('DELETE FROM size_guide_column WHERE size_guide_id = ?', [id]);
      } else {
        run(
          'INSERT INTO size_guide (id, name, description, unit, applies_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [guideId, name, String(formData.get('description') ?? '').trim() || null, unit, appliesTo, nowIso(), nowIso()],
        );
      }

      const columnIds = columns.map((label, index) => {
        const columnId = cuid();
        run('INSERT INTO size_guide_column (id, size_guide_id, key, label, sort_order) VALUES (?, ?, ?, ?, ?)', [
          columnId,
          guideId,
          slugify(label).replace(/-/g, '_') || `col_${index + 1}`,
          label,
          index + 1,
        ]);
        return columnId;
      });

      rowsRaw.forEach((line, rowIndex) => {
        const cells = line.split('|').map((cell) => cell.trim());
        const rowId = cuid();
        run('INSERT INTO size_guide_row (id, size_guide_id, size_label, sort_order) VALUES (?, ?, ?, ?)', [
          rowId,
          guideId,
          cells[0] ?? `Row ${rowIndex + 1}`,
          rowIndex + 1,
        ]);
        cells.slice(1, columns.length + 1).forEach((value, columnIndex) => {
          if (!value) return;
          run('INSERT INTO size_guide_cell (id, row_id, column_id, value) VALUES (?, ?, ?, ?)', [
            cuid(),
            rowId,
            columnIds[columnIndex],
            value,
          ]);
        });
      });
    });

    logAudit({
      entityType: 'SIZE_GUIDE',
      entityId: guideId,
      entityLabel: name,
      action: id ? 'EDIT' : 'CREATE',
      userId: user.id,
      meta: { columns: columns.join(', '), rows: rowsRaw.length },
    });
    revalidatePath('/size-guides');
    return { ok: true, message: id ? 'Size guide updated.' : `Size guide “${name}” created.` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function archiveSizeGuideAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('sizeguide.manage');
    const id = String(formData.get('id') ?? '');
    const row = get<{ name: string; is_archived: number }>('SELECT name, is_archived FROM size_guide WHERE id = ?', [id]);
    if (!row) return { ok: false, error: 'Size guide not found.' };
    run('UPDATE size_guide SET is_archived = ?, updated_at = ? WHERE id = ?', [row.is_archived ? 0 : 1, nowIso(), id]);
    logAudit({
      entityType: 'SIZE_GUIDE',
      entityId: id,
      entityLabel: row.name,
      action: row.is_archived ? 'RESTORE' : 'ARCHIVE',
      userId: user.id,
    });
    revalidatePath('/size-guides');
    return { ok: true, message: row.is_archived ? 'Size guide restored.' : 'Size guide archived.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}


function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? '').trim();
  return value === '' ? null : value;
}
