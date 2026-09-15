import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import {
  assignedTo,
  awaitingApprovalTop,
  catalogStats,
  countsByCategory,
  countsByCollection,
  countsByCulture,
  missingInfoTop,
  missingPhotosTop,
  newestProducts,
  openTasksFor,
  recentExports,
  recentProducts,
} from '@/lib/dashboard';
import { Card, EmptyState, Meter, PageHeader, ReadinessBadge, StatusBadge, formatDateTime } from '@/components/ui';
import type { ProductRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

function Kpi({ href, label, value, hint, tone }: { href: string; label: string; value: number; hint?: string; tone?: string }) {
  return (
    <Link href={href} className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone ?? ''}`}>{value}</span>
      {hint && <span className="text-2xs text-ink-400">{hint}</span>}
    </Link>
  );
}

function ProductList({ rows, empty }: { rows: ProductRow[]; empty: string }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-ink-100">
      {rows.map((product) => (
        <li key={product.id}>
          <Link href={`/products/${product.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-ink-50">
            <span className="mono w-36 shrink-0 truncate text-ink-500">{product.sku}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{product.name ?? <em className="text-ink-400">Unnamed product</em>}</span>
            <span className="hidden w-24 shrink-0 sm:block">
              <Meter value={product.completeness_score ?? 0} />
            </span>
            <span className="w-8 shrink-0 text-right text-2xs text-ink-500">{product.completeness_score ?? 0}%</span>
            <span className="hidden shrink-0 sm:block">
              <StatusBadge status={product.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CountList({ rows, hrefFor, empty }: { rows: Array<{ id: string | null; label: string; count: number }>; hrefFor: (id: string) => string; empty: string }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="divide-y divide-ink-100">
      {rows.map((row) => (
        <li key={`${row.label}-${row.id ?? 'none'}`}>
          {row.id ? (
            <Link href={hrefFor(row.id)} className="flex items-center gap-3 px-4 py-1.5 hover:bg-ink-50">
              <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
              <span className="h-1.5 w-24 shrink-0 rounded-full bg-ink-100">
                <span className="block h-full rounded-full bg-ink-400" style={{ width: `${(row.count / max) * 100}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right text-xs text-ink-600">{row.count}</span>
            </Link>
          ) : (
            <div className="flex items-center gap-3 px-4 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm text-ink-400">{row.label}</span>
              <span className="w-8 shrink-0 text-right text-xs text-ink-400">{row.count}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const stats = catalogStats();
  const [byCategory, byCulture, byCollection, recent, newest, mine, tasks, missingInfo, missingPhotos, approval, exports] =
    await Promise.all([
      Promise.resolve(countsByCategory()),
      Promise.resolve(countsByCulture()),
      Promise.resolve(countsByCollection()),
      Promise.resolve(recentProducts()),
      Promise.resolve(newestProducts()),
      Promise.resolve(assignedTo(user.id)),
      Promise.resolve(openTasksFor(user.id)),
      Promise.resolve(missingInfoTop()),
      Promise.resolve(missingPhotosTop()),
      Promise.resolve(awaitingApprovalTop()),
      Promise.resolve(recentExports()),
    ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Catalog health"
        subtitle={`${stats.total} active product${stats.total === 1 ? '' : 's'} · ${stats.shopifyReady} Shopify ready · ${stats.blocked} blocked`}
        actions={
          <>
            <Link href="/products/new" className="btn btn-primary">
              New product
            </Link>
            <Link href="/exports" className="btn">
              Shopify export
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi href="/products" label="Total products" value={stats.total} />
        <Kpi href="/products?status=DRAFT" label="Draft" value={stats.draft} />
        <Kpi href="/products?missing=info" label="Information missing" value={stats.informationMissing} tone={stats.informationMissing > 0 ? 'text-amber-700' : ''} />
        <Kpi href="/products?missing=photos" label="Photography incomplete" value={stats.photographyIncomplete} tone={stats.photographyIncomplete > 0 ? 'text-amber-700' : ''} />
        <Kpi href="/products?missing=approval" label="In review" value={stats.awaitingApproval} />
        <Kpi href="/products?status=SHOPIFY_READY" label="Approved" value={stats.approved} tone="text-emerald-700" />
        <Kpi href="/products?readiness=READY" label="Shopify ready" value={stats.shopifyReady} tone="text-emerald-700" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi href="/products?readiness=WARNINGS" label="Warnings" value={stats.warnings} tone="text-amber-700" />
        <Kpi href="/products?readiness=BLOCKED" label="Blocked" value={stats.blocked} tone="text-red-700" />
        <Kpi href="/products?nameless=1" label="Not named" value={stats.unnamed} hint={`${stats.named} named`} />
        <Kpi href="/products?unassigned=1" label="Unassigned" value={stats.unassigned} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Missing information">
          <ProductList rows={missingInfo} empty="Every product is complete." />
        </Card>
        <Card title="Photography incomplete">
          <ProductList rows={missingPhotos} empty="Every product has its required shots." />
        </Card>
        <Card title="Awaiting approval">
          <ProductList rows={approval} empty="Nothing waiting on review." />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Products by category">
          <CountList rows={byCategory} hrefFor={(id) => `/products?category=${id}`} empty="No categories yet." />
        </Card>
        <Card title="Products by handloom culture">
          <CountList rows={byCulture} hrefFor={(id) => `/products?culture=${id}`} empty="No cultures yet." />
        </Card>
        <Card title="Products by collection">
          <CountList rows={byCollection} hrefFor={(id) => `/products?collection=${id}`} empty="No collections yet." />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Recently modified">
          <ProductList rows={recent} empty="No products yet." />
        </Card>
        <Card title="Recently created">
          <ProductList rows={newest} empty="No products yet." />
        </Card>
        <Card title="Assigned to you" action={<Link href="/products?assignee=me" className="text-xs text-ink-500 hover:text-ink-900">View all</Link>}>
          {tasks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-ink-100 px-4 py-2">
              {tasks.map((task) => (
                <span key={`${task.task_type}-${task.status}`} className="badge badge-neutral">
                  {task.task_type.toLowerCase()} · {task.count}
                </span>
              ))}
            </div>
          )}
          <ProductList rows={mine} empty="Nothing assigned to you." />
        </Card>
      </div>

      <Card
        title="Shopify export history"
        action={<Link href="/exports" className="text-xs text-ink-500 hover:text-ink-900">All exports</Link>}
      >
        {exports.length === 0 ? (
          <EmptyState title="No exports yet" body="Generate a Shopify product CSV from the Exports page once products are approved." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Mode</th>
                  <th>Products</th>
                  <th>Ready</th>
                  <th>Blocked</th>
                  <th>By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/exports/${row.id}`} className="mono text-brand hover:underline">
                        #{String(row.number).padStart(4, '0')}
                      </Link>
                    </td>
                    <td className="text-xs">{row.mode}</td>
                    <td>{row.product_count}</td>
                    <td className="text-emerald-700">{row.ready_count}</td>
                    <td className={row.blocked_count > 0 ? 'text-red-700' : 'text-ink-400'}>{row.blocked_count}</td>
                    <td className="text-xs">{row.user_name ?? '—'}</td>
                    <td className="text-xs text-ink-500">{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Readiness overview">
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wider text-ink-500">Ready</span>
            <ReadinessBadge state="READY" />
            <span className="text-sm">{stats.shopifyReady} products can be exported now.</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wider text-ink-500">Warnings</span>
            <ReadinessBadge state="WARNINGS" />
            <span className="text-sm">{stats.warnings} products export with warnings.</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wider text-ink-500">Blocked</span>
            <ReadinessBadge state="BLOCKED" />
            <span className="text-sm">{stats.blocked} products are blocked until issues are fixed.</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
