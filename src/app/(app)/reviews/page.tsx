import Link from 'next/link';
import { requireUser, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { assessReadiness } from '@/lib/readiness';
import { bundleFor } from '@/lib/products';
import { Badge, Card, EmptyState, PageHeader, ReadinessBadge, StatusBadge, formatDateTime } from '@/components/ui';
import { STATUS_LABELS, type ProductStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const REVIEWABLE: ProductStatus[] = [
  'INFORMATION_COMPLETE',
  'PHOTOGRAPHY_COMPLETE',
  'CONTENT_REVIEW',
  'INTERNAL_REVIEW',
  'FOUNDER_APPROVAL',
  'SHOPIFY_READY',
  'CHANGES_REQUESTED',
  'REJECTED',
];

interface ReviewRow {
  id: string;
  sku: string;
  name: string | null;
  status: ProductStatus;
  readiness_state: string;
  completeness_score: number;
  updated_at: string;
  assignee_name: string | null;
  category_name: string | null;
}

export default async function ReviewsPage() {
  const user = await requireUser();
  const canReview = userCan(user, 'product.review');

  const rows = all<ReviewRow>(
    `SELECT p.id, p.sku, p.name, p.status, p.readiness_state, p.completeness_score, p.updated_at,
            u.name AS assignee_name, c.name AS category_name
     FROM product p
     LEFT JOIN "user" u ON u.id = p.assignee_id
     LEFT JOIN category c ON c.id = p.category_id
     WHERE p.is_archived = 0 AND p.status IN (${REVIEWABLE.map(() => '?').join(',')})
     ORDER BY p.updated_at ASC`,
    REVIEWABLE,
  );

  const assessed = rows
    .map((row) => {
      const bundle = bundleFor(row as never);
      const readiness = bundle ? assessReadiness(bundle) : null;
      return { row, readiness };
    })
    .sort((a, b) => {
      const rank = (state: string | null) => (state === 'READY' ? 0 : state === 'WARNINGS' ? 1 : 2);
      return rank(a.readiness?.state ?? null) - rank(b.readiness?.state ?? null);
    });

  const counts = {
    ready: assessed.filter((entry) => entry.readiness?.state === 'READY').length,
    warnings: assessed.filter((entry) => entry.readiness?.state === 'WARNINGS').length,
    blocked: assessed.filter((entry) => entry.readiness?.state === 'BLOCKED').length,
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Review & approval queue"
        subtitle="Ready products first. Nothing can be approved to Shopify Ready while blocking issues remain."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="In review" value={assessed.length} />
        <Kpi label="Ready to approve" value={counts.ready} tone="text-emerald-700" />
        <Kpi label="With warnings" value={counts.warnings} tone="text-amber-700" />
        <Kpi label="Blocked" value={counts.blocked} tone="text-red-700" />
      </div>

      {assessed.length === 0 ? (
        <EmptyState title="Nothing waiting for review" body="Products move into this queue when their status reaches content or internal review." />
      ) : (
        <Card title={`Queue (${assessed.length})`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Readiness</th>
                  <th>Complete</th>
                  <th>Assigned</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assessed.map(({ row, readiness }) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/products/${row.id}?tab=review`} className="font-medium text-brand hover:underline">
                        {row.name ?? <em className="text-ink-400">Unnamed</em>}
                      </Link>
                      <div className="mono text-2xs text-ink-500">{row.sku}</div>
                    </td>
                    <td className="text-xs">{row.category_name ?? '—'}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>{readiness ? <ReadinessBadge state={readiness.state} /> : <Badge tone="neutral">—</Badge>}</td>
                    <td className="text-center">{row.completeness_score}%</td>
                    <td className="text-xs">{row.assignee_name ?? <span className="text-ink-300">unassigned</span>}</td>
                    <td className="whitespace-nowrap text-2xs text-ink-500">{formatDateTime(row.updated_at)}</td>
                    <td>
                      <Link href={`/products/${row.id}?tab=review`} className="btn btn-sm">
                        {canReview ? 'Review' : 'Open'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Approval rules">
        <ul className="list-disc px-8 py-3 text-xs text-ink-600">
          <li>Approval to {STATUS_LABELS.SHOPIFY_READY} requires a readiness state of READY — errors can never be overridden.</li>
          <li>Requesting changes or rejecting requires a reason; it is stored on the review and in the audit log.</li>
          <li>Each decision is recorded with the reviewer, timestamp and per-area checklist.</li>
        </ul>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2">
      <p className="text-2xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`text-xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
