import { requireUser, userCan } from '@/lib/auth';
import { all, parseJson } from '@/lib/db';
import type { CompletenessResult, ProductBundle } from '@/lib/completeness';
import type { ReadinessResult } from '@/lib/readiness';
import { parseChanges } from '@/lib/audit';
import { Badge, Card, EmptyState, ReadinessBadge, formatDateTime } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { addCommentAction, resolveCommentAction, reviewAction } from '@/app/actions/products';
import { FormActions } from './fields';

interface Photos {
  complete: number;
  required: number;
}

export async function CommentsTab({ bundle, users }: { bundle: ProductBundle; users: Array<{ id: string; name: string }> }) {
  const user = await requireUser();
  const { product } = bundle;
  const comments = all<{
    id: string;
    body: string;
    mentions: string;
    is_resolved: number;
    created_at: string;
    user_id: string;
    user_name: string;
  }>(
    `SELECT c.id, c.body, c.mentions, c.is_resolved, c.created_at, c.user_id, u.name AS user_name
     FROM comment c LEFT JOIN "user" u ON u.id = c.user_id
     WHERE c.product_id = ? ORDER BY c.created_at DESC`,
    [product.id],
  );
  const canComment = userCan(user, 'comment.create');

  return (
    <div className="flex flex-col gap-4">
      {canComment && (
        <ActionForm action={addCommentAction}>
          <Card title="Add a comment" action={<span className="text-2xs text-ink-400">Use @name to mention a teammate</span>}>
            <input type="hidden" name="product_id" value={product.id} />
            <div className="px-4 py-3">
              <textarea
                className="field"
                name="body"
                rows={3}
                required
                placeholder="Need the correct blouse measurement. / Confirm if the zari is pure zari."
              />
            </div>
            <FormActions label="Post comment" />
          </Card>
        </ActionForm>
      )}

      <Card title={`Comments (${comments.length})`}>
        {comments.length === 0 ? (
          <EmptyState title="No comments yet" />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-100">
            {comments.map((comment) => {
              const mentions = parseJson<string[]>(comment.mentions, []);
              return (
                <li key={comment.id} className={`flex flex-col gap-1 px-4 py-2.5 ${comment.is_resolved ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{comment.user_name ?? 'Unknown'}</span>
                    <span className="text-2xs text-ink-400">{formatDateTime(comment.created_at)}</span>
                    {comment.is_resolved === 1 && <Badge tone="success">Resolved</Badge>}
                    {mentions.length > 0 && (
                      <span className="text-2xs text-ink-400">
                        mentioned {mentions.map((id) => users.find((u) => u.id === id)?.name ?? id).join(', ')}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ink-800">{comment.body}</p>
                  {comment.user_id === user.id && (
                    <ActionForm action={resolveCommentAction} className="mt-1">
                      <input type="hidden" name="comment_id" value={comment.id} />
                      <input type="hidden" name="product_id" value={product.id} />
                      <button className="btn btn-sm" type="submit">
                        {comment.is_resolved === 1 ? 'Re-open' : 'Mark resolved'}
                      </button>
                    </ActionForm>
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

export async function HistoryTab({ productId }: { productId: string }) {
  const audit = all<{
    id: string;
    action: string;
    changes: string;
    meta: string | null;
    created_at: string;
    user_name: string | null;
  }>(
    `SELECT a.id, a.action, a.changes, a.meta, a.created_at, u.name AS user_name
     FROM audit_log a LEFT JOIN "user" u ON u.id = a.user_id
     WHERE a.entity_type = 'PRODUCT' AND a.entity_id = ?
     ORDER BY a.created_at DESC LIMIT 300`,
    [productId],
  );
  const snapshots = all<{ id: string; version: number; reason: string | null; data: string; created_at: string; user_name: string | null }>(
    `SELECT s.id, s.version, s.reason, s.data, s.created_at, u.name AS user_name
     FROM product_snapshot s LEFT JOIN "user" u ON u.id = s.user_id
     WHERE s.product_id = ? ORDER BY s.version DESC LIMIT 20`,
    [productId],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card title="Change history" action={<span className="text-2xs text-ink-400">Who changed what, with old and new values</span>}>
        {audit.length === 0 ? (
          <EmptyState title="No changes recorded yet" />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-100">
            {audit.map((entry) => {
              const changes = parseChanges(entry.changes);
              const meta = entry.meta ? (parseJson<Record<string, unknown>>(entry.meta, {}) as Record<string, unknown>) : null;
              return (
                <li key={entry.id} className="flex flex-col gap-1 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{entry.action.replace(/_/g, ' ').toLowerCase()}</Badge>
                    <span className="text-xs text-ink-500">{entry.user_name ?? 'System'}</span>
                    <span className="text-2xs text-ink-400">{formatDateTime(entry.created_at)}</span>
                  </div>
                  {changes.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {changes.map((change, index) => (
                        <li key={`${entry.id}-${index}`} className="text-xs">
                          <span className="font-medium text-ink-700">{change.label}: </span>
                          <span className="text-red-700 line-through">{render(change.oldValue)}</span>
                          <span className="px-1 text-ink-400">→</span>
                          <span className="text-emerald-700">{render(change.newValue)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {meta && typeof meta.comment === 'string' && meta.comment && (
                    <p className="text-xs text-ink-600">“{meta.comment}”</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Snapshots" action={<span className="text-2xs text-ink-400">Critical fields captured before each edit</span>}>
        {snapshots.length === 0 ? (
          <EmptyState title="No snapshots yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Reason</th>
                  <th>By</th>
                  <th>When</th>
                  <th>Tracked fields</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => {
                  const data = parseJson<Record<string, unknown>>(snapshot.data, {});
                  const filled = Object.entries(data).filter(([, value]) => value !== null && value !== '');
                  return (
                    <tr key={snapshot.id}>
                      <td className="mono">v{snapshot.version}</td>
                      <td className="text-xs">{snapshot.reason ?? '—'}</td>
                      <td className="text-xs">{snapshot.user_name ?? '—'}</td>
                      <td className="whitespace-nowrap text-2xs text-ink-500">{formatDateTime(snapshot.created_at)}</td>
                      <td className="text-2xs text-ink-500">{filled.map(([key]) => key).join(', ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (Array.isArray(value)) return value.length === 0 ? 'empty' : value.join(', ');
  return String(value);
}

export async function ReviewTab({
  bundle,
  readiness,
  completeness,
  photos,
}: {
  bundle: ProductBundle;
  readiness: ReadinessResult;
  completeness: CompletenessResult;
  photos: Photos;
}) {
  const user = await requireUser();
  const { product } = bundle;
  const canReview = userCan(user, 'product.review');
  const reviews = all<{ id: string; decision: string; checklist: string; comment: string | null; created_at: string; user_name: string }>(
    `SELECT r.id, r.decision, r.checklist, r.comment, r.created_at, u.name AS user_name
     FROM product_review r LEFT JOIN "user" u ON u.id = r.user_id
     WHERE r.product_id = ? ORDER BY r.created_at DESC`,
    [product.id],
  );

  const rows: Array<{ key: string; label: string; ok: boolean; detail: string }> = [
    {
      key: 'information',
      label: 'Information',
      ok: completeness.requiredMissing.filter((m) => m.section !== 'IMAGES').length === 0,
      detail: `${completeness.score}% complete`,
    },
    {
      key: 'images',
      label: 'Images',
      ok: photos.required === 0 ? bundle.images.length > 0 : photos.complete === photos.required,
      detail: `${photos.complete}/${photos.required} required assets`,
    },
    {
      key: 'measurements',
      label: 'Measurements',
      ok: completeness.bySection.MEASUREMENTS.missing.length === 0,
      detail: completeness.bySection.MEASUREMENTS.missing.map((m) => m.label).join(', ') || 'complete',
    },
    {
      key: 'content',
      label: 'Content',
      ok: completeness.bySection.CONTENT.missing.filter((m) => m.severity === 'REQUIRED').length === 0,
      detail: completeness.bySection.CONTENT.missing.map((m) => m.label).join(', ') || 'complete',
    },
    { key: 'seo', label: 'SEO', ok: Boolean(product.handle && product.seo_title && product.seo_description), detail: product.handle ?? 'no handle' },
    { key: 'pricing', label: 'Pricing', ok: completeness.bySection.PRICING.missing.filter((m) => m.severity === 'REQUIRED').length === 0, detail: product.price ? `${product.currency} ${product.price}` : 'no price' },
    { key: 'collections', label: 'Collections', ok: bundle.collections.length > 0, detail: bundle.collections.map((c) => c.name).join(', ') || 'none' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Product review" action={<ReadinessBadge state={readiness.state} />}>
        <div className="flex flex-col px-4 py-3">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-3 border-b border-ink-100 py-1.5 last:border-0">
              <span className={`w-4 text-center ${row.ok ? 'text-emerald-600' : 'text-red-600'}`}>{row.ok ? '✓' : '✕'}</span>
              <span className="w-32 text-sm">{row.label}</span>
              <span className="text-xs text-ink-500">{row.detail}</span>
            </div>
          ))}
        </div>
      </Card>

      {readiness.issues.length > 0 && (
        <Card title={`Blocking and advisory issues (${readiness.issues.length})`}>
          <ul className="flex flex-col divide-y divide-ink-100">
            {readiness.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className="flex items-start gap-2 px-4 py-1.5">
                <Badge tone={issue.severity === 'ERROR' ? 'danger' : 'warn'}>{issue.severity === 'ERROR' ? 'Error' : 'Warning'}</Badge>
                <span className="text-xs text-ink-700">{issue.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canReview && (
        <ActionForm action={reviewAction}>
          <Card title="Decision">
            <input type="hidden" name="product_id" value={product.id} />
            <div className="grid gap-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
              {rows.map((row) => (
                <label key={row.key} className="flex items-center gap-2 text-sm normal-case">
                  <input type="checkbox" name={`check_${row.key}`} defaultChecked={row.ok} />
                  {row.label}
                </label>
              ))}
            </div>
            <div className="px-4 pb-3">
              <textarea className="field" name="comment" rows={3} placeholder="Reason — required when requesting changes or rejecting." />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-ink-200 px-4 py-2.5">
              <button
                className="btn btn-sm btn-primary"
                type="submit"
                name="decision"
                value="APPROVED"
                disabled={readiness.state !== 'READY'}
                title={readiness.state === 'READY' ? undefined : 'Fix blocking issues first'}
              >
                Approve
              </button>
              <button className="btn btn-sm" type="submit" name="decision" value="CHANGES_REQUESTED">
                Request changes
              </button>
              <button className="btn btn-sm btn-danger" type="submit" name="decision" value="REJECTED">
                Reject
              </button>
              {readiness.state !== 'READY' && (
                <span className="text-2xs text-ink-400">Approval is blocked while errors remain.</span>
              )}
            </div>
          </Card>
        </ActionForm>
      )}

      <Card title="Previous decisions">
        {reviews.length === 0 ? (
          <EmptyState title="No review decisions recorded." />
        ) : (
          <ul className="flex flex-col divide-y divide-ink-100">
            {reviews.map((review) => (
              <li key={review.id} className="flex flex-col gap-1 px-4 py-2">
                <div className="flex items-center gap-2">
                  <Badge tone={review.decision === 'APPROVED' ? 'success' : review.decision === 'REJECTED' ? 'danger' : 'warn'}>
                    {review.decision.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                  <span className="text-xs text-ink-500">{review.user_name ?? 'Unknown'}</span>
                  <span className="text-2xs text-ink-400">{formatDateTime(review.created_at)}</span>
                </div>
                {review.comment && <p className="text-xs text-ink-700">{review.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
