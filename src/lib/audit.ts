/**
 * Audit trail (spec §27/§28).
 *
 * Every mutation records who changed what, with old and new values. Field
 * labels come from the caller so the log reads like the UI.
 */
import { all, get, json, run } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import type { AuditRow, FieldChange } from '@/lib/types';

export interface AuditInput {
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  action: string;
  changes?: FieldChange[];
  meta?: Record<string, unknown> | null;
  userId?: string | null;
}

/**
 * Builds a FieldChange list from two row snapshots, ignoring unchanged and
 * bookkeeping columns. Pass `labels` to show friendly field names.
 */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  labels?: Record<string, string>,
  skip: string[] = ['updated_at', 'created_at'],
): FieldChange[] {
  if (!before || !after) return [];
  const changes: FieldChange[] = [];
  for (const key of Object.keys(after)) {
    if (skip.includes(key)) continue;
    const oldValue = before[key];
    const newValue = after[key];
    if (oldValue === newValue) continue;
    changes.push({ field: key, label: labels?.[key] ?? key, oldValue: oldValue ?? null, newValue: newValue ?? null });
  }
  return changes;
}

export function logAudit(input: AuditInput): void {
  run(
    `INSERT INTO audit_log (id, entity_type, entity_id, entity_label, action, changes, meta, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cuid(),
      input.entityType,
      input.entityId,
      input.entityLabel ?? null,
      input.action,
      json(input.changes ?? []),
      input.meta ? json(input.meta) : null,
      input.userId ?? null,
      nowIso(),
    ],
  );
}

function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

/** Builds a change list from before/after snapshots. */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels?: Record<string, string>,
  ignore: string[] = [],
): FieldChange[] {
  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const oldValue = normalize(before[key]);
    const newValue = normalize(after[key]);
    const same = JSON.stringify(oldValue) === JSON.stringify(newValue);
    if (same) continue;
    changes.push({ field: key, label: labels?.[key] ?? key, oldValue, newValue });
  }
  return changes;
}

export function parseChanges(raw: string | null): FieldChange[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FieldChange[]) : [];
  } catch {
    return [];
  }
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function queryAudit(q: AuditQuery = {}): { rows: AuditRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.entityType) { where.push('a.entity_type = ?'); params.push(q.entityType); }
  if (q.entityId) { where.push('a.entity_id = ?'); params.push(q.entityId); }
  if (q.userId) { where.push('a.user_id = ?'); params.push(q.userId); }
  if (q.action) { where.push('a.action = ?'); params.push(q.action); }
  if (q.search) {
    where.push('(a.entity_label LIKE ? OR a.changes LIKE ?)');
    params.push(`%${q.search}%`, `%${q.search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM audit_log a ${clause}`,
    params,
  )?.c ?? 0;
  const rows = all<AuditRow>(
    `SELECT a.*, u.name AS user_name
     FROM audit_log a LEFT JOIN "user" u ON u.id = a.user_id
     ${clause}
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, q.limit ?? 100, q.offset ?? 0],
  );
  return { rows, total };
}
