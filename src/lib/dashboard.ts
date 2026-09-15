import 'server-only';
import { all, get } from '@/lib/db';
import type { ProductRow } from '@/lib/types';

export interface CatalogStats {
  total: number;
  draft: number;
  informationMissing: number;
  photographyIncomplete: number;
  contentReview: number;
  awaitingApproval: number;
  approved: number;
  shopifyReady: number;
  warnings: number;
  blocked: number;
  exported: number;
  published: number;
  archived: number;
  changesRequested: number;
  unassigned: number;
  named: number;
  unnamed: number;
}

export function catalogStats(): CatalogStats {
  const row = get<Record<string, number>>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft,
      SUM(CASE WHEN completeness_score < 100 THEN 1 ELSE 0 END) AS information_missing,
      SUM(CASE WHEN photography_required > 0 AND photography_complete < photography_required THEN 1 ELSE 0 END) AS photography_incomplete,
      SUM(CASE WHEN status = 'CONTENT_REVIEW' THEN 1 ELSE 0 END) AS content_review,
      SUM(CASE WHEN status IN ('CONTENT_REVIEW','INTERNAL_REVIEW','FOUNDER_APPROVAL') THEN 1 ELSE 0 END) AS awaiting_approval,
      SUM(CASE WHEN status IN ('SHOPIFY_READY','EXPORTED','PUBLISHED') THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN readiness_state = 'READY' THEN 1 ELSE 0 END) AS shopify_ready,
      SUM(CASE WHEN readiness_state = 'WARNINGS' THEN 1 ELSE 0 END) AS warnings,
      SUM(CASE WHEN readiness_state = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status = 'EXPORTED' THEN 1 ELSE 0 END) AS exported,
      SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status = 'CHANGES_REQUESTED' THEN 1 ELSE 0 END) AS changes_requested,
      SUM(CASE WHEN assignee_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
      SUM(CASE WHEN name IS NOT NULL AND name != '' THEN 1 ELSE 0 END) AS named,
      SUM(CASE WHEN name IS NULL OR name = '' THEN 1 ELSE 0 END) AS unnamed
    FROM product WHERE is_archived = 0
  `);
  const n = (key: string) => Number(row?.[key] ?? 0);
  const archived = get<{ c: number }>('SELECT COUNT(*) AS c FROM product WHERE is_archived = 1')?.c ?? 0;
  return {
    total: n('total'),
    draft: n('draft'),
    informationMissing: n('information_missing'),
    photographyIncomplete: n('photography_incomplete'),
    contentReview: n('content_review'),
    awaitingApproval: n('awaiting_approval'),
    approved: n('approved'),
    shopifyReady: n('shopify_ready'),
    warnings: n('warnings'),
    blocked: n('blocked'),
    exported: n('exported'),
    published: n('published'),
    archived,
    changesRequested: n('changes_requested'),
    unassigned: n('unassigned'),
    named: n('named'),
    unnamed: n('unnamed'),
  };
}

export interface CountRow {
  id: string | null;
  label: string;
  count: number;
}

export function countsByCategory(): CountRow[] {
  return all<CountRow>(`
    SELECT c.id AS id, COALESCE(c.name, 'Uncategorised') AS label, COUNT(p.id) AS count
    FROM product p LEFT JOIN category c ON c.id = p.category_id
    WHERE p.is_archived = 0
    GROUP BY c.id, c.name ORDER BY count DESC, label ASC
  `);
}

export function countsByCulture(): CountRow[] {
  return all<CountRow>(`
    SELECT hc.id AS id, COALESCE(hc.name, 'No culture') AS label, COUNT(p.id) AS count
    FROM product p LEFT JOIN handloom_culture hc ON hc.id = p.handloom_culture_id
    WHERE p.is_archived = 0
    GROUP BY hc.id, hc.name ORDER BY count DESC, label ASC
  `);
}

export function countsByCollection(): CountRow[] {
  return all<CountRow>(`
    SELECT c.id AS id, c.name AS label, COUNT(pc.product_id) AS count
    FROM collection c LEFT JOIN product_collection pc ON pc.collection_id = c.id
    LEFT JOIN product p ON p.id = pc.product_id AND p.is_archived = 0
    GROUP BY c.id, c.name ORDER BY count DESC, label ASC
  `);
}

export function recentProducts(limit = 8): ProductRow[] {
  return all<ProductRow>(
    `SELECT p.sku, p.id, p.name, p.status, p.completeness_score, p.readiness_state, p.updated_at
     FROM product p WHERE p.is_archived = 0 ORDER BY p.updated_at DESC LIMIT ?`,
    [limit],
  );
}

export function newestProducts(limit = 8): ProductRow[] {
  return all<ProductRow>(
    `SELECT p.sku, p.id, p.name, p.status, p.completeness_score, p.readiness_state, p.created_at AS updated_at
     FROM product p WHERE p.is_archived = 0 ORDER BY p.created_at DESC LIMIT ?`,
    [limit],
  );
}

export function assignedTo(userId: string, limit = 10): ProductRow[] {
  return all<ProductRow>(
    `SELECT p.sku, p.id, p.name, p.status, p.completeness_score, p.readiness_state, p.updated_at
     FROM product p WHERE p.assignee_id = ? AND p.is_archived = 0
     ORDER BY p.updated_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export function openTasksFor(userId: string): Array<{ task_type: string; status: string; count: number }> {
  return all<{ task_type: string; status: string; count: number }>(
    `SELECT task_type, status, COUNT(*) AS count FROM assignment
     WHERE user_id = ? AND status IN ('OPEN','IN_PROGRESS')
     GROUP BY task_type, status ORDER BY task_type`,
    [userId],
  );
}

export function missingInfoTop(limit = 8): ProductRow[] {
  return all<ProductRow>(
    `SELECT p.sku, p.id, p.name, p.status, p.completeness_score, p.readiness_state, p.updated_at
     FROM product p WHERE p.is_archived = 0 AND p.completeness_score < 100
     ORDER BY p.completeness_score ASC, p.updated_at DESC LIMIT ?`,
    [limit],
  );
}

export function missingPhotosTop(limit = 8): ProductRow[] {
  return all<ProductRow>(
    `SELECT p.sku, p.id, p.name, p.status, p.photography_complete, p.photography_required, p.completeness_score,
            p.readiness_state, p.updated_at
     FROM product p
     WHERE p.is_archived = 0 AND p.photography_required > 0 AND p.photography_complete < p.photography_required
     ORDER BY (p.photography_required - p.photography_complete) DESC, p.updated_at DESC LIMIT ?`,
    [limit],
  );
}

export function awaitingApprovalTop(limit = 8): ProductRow[] {
  return all<ProductRow>(
    `SELECT p.sku, p.id, p.name, p.status, p.completeness_score, p.readiness_state, p.updated_at
     FROM product p
     WHERE p.is_archived = 0 AND p.status IN ('CONTENT_REVIEW','INTERNAL_REVIEW','FOUNDER_APPROVAL','CHANGES_REQUESTED')
     ORDER BY p.updated_at ASC LIMIT ?`,
    [limit],
  );
}

export function recentExports(limit = 5) {
  return all<{
    id: string;
    number: number;
    mode: string;
    product_count: number;
    ready_count: number;
    blocked_count: number;
    created_at: string;
    user_name: string | null;
    file_name: string | null;
  }>(
    `SELECT e.id, e.number, e.mode, e.product_count, e.ready_count, e.blocked_count, e.created_at,
            e.file_name, u.name AS user_name
     FROM export_run e LEFT JOIN "user" u ON u.id = e.user_id
     ORDER BY e.created_at DESC LIMIT ?`,
    [limit],
  );
}
