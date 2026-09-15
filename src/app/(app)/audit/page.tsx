import { requirePermission } from '@/lib/auth';
import { all, parseJson } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader, formatDateTime } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  action: string;
  changes: string;
  meta: string | null;
  created_at: string;
  user_name: string | null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string; action?: string; user?: string; q?: string }> }) {
  await requirePermission('audit.view');
  const params = await searchParams;

  const types = all<{ entity_type: string; n: number }>('SELECT entity_type, COUNT(*) AS n FROM audit_log GROUP BY entity_type ORDER BY entity_type');
  const actions = all<{ action: string }>('SELECT DISTINCT action FROM audit_log ORDER BY action');
  const users = all<{ id: string; name: string }>('SELECT id, name FROM "user" ORDER BY name');

  const where: string[] = [];
  const args: string[] = [];
  if (params.type) { where.push('a.entity_type = ?'); args.push(params.type); }
  if (params.action) { where.push('a.action = ?'); args.push(params.action); }
  if (params.user) { where.push('a.user_id = ?'); args.push(params.user); }
  if (params.q) { where.push('(a.entity_label LIKE ? OR a.entity_id LIKE ?)'); args.push(`%${params.q}%`, `%${params.q}%`); }

  const rows = all<AuditRow>(
    `SELECT a.id, a.entity_type, a.entity_id, a.entity_label, a.action, a.changes, a.meta, a.created_at, u.name AS user_name
     FROM audit_log a LEFT JOIN "user" u ON u.id = a.user_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.created_at DESC LIMIT 400`,
    args,
  );

  const total = Number(all<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')[0]?.n ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Audit log"
        subtitle={`${total} recorded events. Every change stores the field, its old value and its new value — this log is never editable.`}
      />

      <Card title="Filter">
        <form className="flex flex-wrap items-end gap-2 px-4 py-3">
          <label className="text-xs">
            <span className="text-ink-600">Entity</span>
            <select className="field field-sm" name="type" defaultValue={params.type ?? ''}>
              <option value="">All</option>
              {types.map((type) => (
                <option key={type.entity_type} value={type.entity_type}>
                  {type.entity_type.toLowerCase()} ({type.n})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-ink-600">Action</span>
            <select className="field field-sm" name="action" defaultValue={params.action ?? ''}>
              <option value="">All</option>
              {actions.map((action) => (
                <option key={action.action} value={action.action}>
                  {action.action}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-ink-600">User</span>
            <select className="field field-sm" name="user" defaultValue={params.user ?? ''}>
              <option value="">Everyone</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="text-ink-600">Search</span>
            <input className="field field-sm w-48" name="q" defaultValue={params.q ?? ''} placeholder="Label or id" />
          </label>
          <button className="btn btn-sm" type="submit">
            Apply
          </button>
        </form>
      </Card>

      <Card title={`Events (${rows.length}${rows.length === 400 ? ' — latest 400' : ''})`}>
        {rows.length === 0 ? (
          <EmptyState title="No events match this filter" />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-100">
            {rows.map((row) => {
              const changes = parseJson<Array<{ label: string; oldValue: unknown; newValue: unknown }>>(row.changes, []);
              const meta = row.meta ? parseJson<Record<string, unknown>>(row.meta, {}) : null;
              return (
                <li key={row.id} className="flex flex-col gap-1 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{row.entity_type.toLowerCase()}</Badge>
                    <span className="text-xs font-medium">{row.action.replace(/_/g, ' ').toLowerCase()}</span>
                    <span className="text-xs text-ink-600">{row.entity_label ?? row.entity_id}</span>
                    <span className="ml-auto text-xs text-ink-500">{row.user_name ?? 'System'}</span>
                    <span className="whitespace-nowrap text-2xs text-ink-400">{formatDateTime(row.created_at)}</span>
                  </div>
                  {changes.length > 0 && (
                    <ul className="flex flex-col gap-0.5">
                      {changes.map((change, index) => (
                        <li key={index} className="text-xs text-ink-600">
                          <span className="font-medium text-ink-700">{change.label}: </span>
                          <span className="text-red-700 line-through">{show(change.oldValue)}</span>
                          <span className="px-1 text-ink-400">→</span>
                          <span className="text-emerald-700">{show(change.newValue)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {meta && Object.keys(meta).length > 0 && (
                    <p className="text-2xs text-ink-400">
                      {Object.entries(meta)
                        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
                        .join(' · ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : value.join(', ');
  return String(value);
}
