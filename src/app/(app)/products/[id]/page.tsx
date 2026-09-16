import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { bundleFor, getProduct, productMeasurements, productTags } from '@/lib/products';
import { computeCompleteness, photographyCounters } from '@/lib/completeness';
import { assessReadiness } from '@/lib/readiness';
import { canTransition, nextStatuses } from '@/lib/workflow';
import { resolvePublicUrl } from '@/lib/storage';
import { publicBaseUrlForRequest } from '@/lib/public-url';
import {
  Badge,
  Card,
  Meter,
  ReadinessBadge,
  StatusBadge,
  StatRow,
  formatDateTime,
} from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { archiveAction, changeStatusAction } from '@/app/actions/products';
import { OverviewTab, ProductDataTab, HandloomTab, MeasurementsTab } from './sections/basic';
import { ContentTab, SeoTab } from './sections/content';
import { ImagesTab } from './sections/media';
import { VariantsTab, CollectionsTab } from './sections/commerce';
import { CommentsTab, HistoryTab, ReviewTab } from './sections/collab';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'data', label: 'Product data' },
  { key: 'handloom', label: 'Handloom & craft' },
  { key: 'measurements', label: 'Measurements' },
  { key: 'images', label: 'Images' },
  { key: 'content', label: 'Story & content' },
  { key: 'seo', label: 'SEO' },
  { key: 'variants', label: 'Variants & pricing' },
  { key: 'collections', label: 'Collections' },
  { key: 'comments', label: 'Comments' },
  { key: 'history', label: 'Change history' },
  { key: 'review', label: 'Review' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const publicBaseUrl = await publicBaseUrlForRequest();
  const { id } = await params;
  const { tab } = await searchParams;
  const product = getProduct(id);
  if (!product) notFound();

  const bundle = bundleFor(product);
  if (!bundle) notFound();

  const completeness = computeCompleteness(bundle);
  const photos = photographyCounters(bundle);
  const imagesPublic = bundle.images.every((img) =>
    Boolean(
      resolvePublicUrl({
        storageBackend: img.storage_backend,
        storageKey: img.storage_key,
        driveFileId: img.drive_file_id,
        publicUrl: img.public_url,
        publicBaseUrl,
      }),
    ),
  );
  const readiness = assessReadiness(bundle, {
    imagesPubliclyAccessible: bundle.images.length > 0 ? imagesPublic : undefined,
  });

  const activeTab = (TABS.some((t) => t.key === tab) ? tab : 'overview') as TabKey;
  const users = all<{ id: string; name: string }>('SELECT id, name FROM "user" WHERE is_active = 1 ORDER BY name');
  const assignments = all<{ id: string; task_type: string; user_id: string; status: string; note: string | null; due_at: string | null }>(
    'SELECT id, task_type, user_id, status, note, due_at FROM assignment WHERE product_id = ? ORDER BY task_type',
    [id],
  );
  const commentCount = all<{ c: number }>('SELECT COUNT(*) AS c FROM comment WHERE product_id = ?', [id])[0]?.c ?? 0;

  const transitions = nextStatuses(product.status).map((rule) => ({
    ...rule,
    check: canTransition(product.status, rule.to, {
      readinessState: readiness.state,
      permissions: user.permissions,
    }),
  }));

  const tabHref = (key: TabKey) => `/products/${product.id}?tab=${key}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate">{product.name ?? <em className="text-ink-400">Unnamed product</em>}</h1>
            <StatusBadge status={product.status} />
            <ReadinessBadge state={readiness.state} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span className="mono">{product.sku}</span>
            {product.internal_reference && <span>· ref {product.internal_reference}</span>}
            {product.handle && <span className="mono">· /{product.handle}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {userCan(user, 'product.edit') && (
            <Link className="btn btn-sm" href={tabHref('data')}>
              Edit
            </Link>
          )}
          {userCan(user, 'product.edit') && (
            <Link className="btn btn-sm" href={tabHref('content')}>
              Content
            </Link>
          )}
          {userCan(user, 'image.upload') && (
            <Link className="btn btn-sm" href={tabHref('images')}>
              Images
            </Link>
          )}
          {userCan(user, 'product.review') && (
            <Link className="btn btn-sm btn-primary" href={tabHref('review')}>
              Review
            </Link>
          )}
          {userCan(user, 'export.run') && (
            <Link className="btn btn-sm" href={`/exports?product=${product.id}`}>
              Export
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <nav className="flex gap-1 overflow-x-auto border-b border-ink-200">
            {TABS.map((entry) => (
              <Link
                key={entry.key}
                href={tabHref(entry.key)}
                className={`tab-link ${activeTab === entry.key ? 'tab-link-active' : ''}`}
              >
                {entry.label}
                {entry.key === 'comments' && commentCount > 0 && <span className="ml-1 text-2xs text-ink-400">{commentCount}</span>}
              </Link>
            ))}
          </nav>

          {activeTab === 'overview' && (
            <OverviewTab bundle={bundle} completeness={completeness} readiness={readiness} photos={photos} assignments={assignments} users={users} />
          )}
          {activeTab === 'data' && <ProductDataTab bundle={bundle} />}
          {activeTab === 'handloom' && <HandloomTab bundle={bundle} />}
          {activeTab === 'measurements' && <MeasurementsTab bundle={bundle} measurements={productMeasurements(product)} />}
          {activeTab === 'images' && <ImagesTab bundle={bundle} photos={photos} publicBaseUrl={publicBaseUrl} />}
          {activeTab === 'content' && <ContentTab bundle={bundle} />}
          {activeTab === 'seo' && <SeoTab bundle={bundle} />}
          {activeTab === 'variants' && <VariantsTab bundle={bundle} tags={productTags(product)} />}
          {activeTab === 'collections' && <CollectionsTab bundle={bundle} />}
          {activeTab === 'comments' && <CommentsTab bundle={bundle} users={users} />}
          {activeTab === 'history' && <HistoryTab productId={product.id} />}
          {activeTab === 'review' && <ReviewTab bundle={bundle} readiness={readiness} completeness={completeness} photos={photos} />}
        </div>

        <aside className="flex flex-col gap-3">
          <Card title="Progress">
            <div className="flex flex-col gap-3 px-4 py-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xs uppercase tracking-wider text-ink-500">Product completeness</span>
                  <span className="text-sm font-semibold">{completeness.score}%</span>
                </div>
                <Meter value={completeness.score} />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xs uppercase tracking-wider text-ink-500">Photography</span>
                  <span className="text-sm font-semibold">
                    {photos.complete}/{photos.required}
                  </span>
                </div>
                <Meter value={photos.required === 0 ? 0 : (photos.complete / photos.required) * 100} />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xs uppercase tracking-wider text-ink-500">Shopify readiness</span>
                  <ReadinessBadge state={readiness.state} />
                </div>
                <Meter value={readiness.score} />
              </div>
            </div>
          </Card>

          <Card title="Details">
            <div className="px-4 py-2">
              <StatRow label="Assigned to" value={product.assignee_name ?? 'Unassigned'} />
              <StatRow label="Category" value={product.category_name ?? '—'} />
              <StatRow label="Culture" value={product.culture_name ?? '—'} />
              <StatRow label="Name status" value={product.name_status.replace(/_/g, ' ').toLowerCase()} />
              <StatRow label="Created by" value={product.creator_name ?? '—'} />
              <StatRow label="Created" value={formatDateTime(product.created_at)} />
              <StatRow label="Last updated" value={formatDateTime(product.updated_at)} />
              <StatRow label="Last exported" value={product.last_exported_at ? formatDateTime(product.last_exported_at) : 'Never'} />
            </div>
          </Card>

          {readiness.issues.length > 0 && (
            <Card title={`Issues (${readiness.issues.length})`}>
              <ul className="flex flex-col divide-y divide-ink-100">
                {readiness.issues.slice(0, 12).map((issue, index) => (
                  <li key={`${issue.code}-${index}`} className="flex items-start gap-2 px-4 py-1.5">
                    <Badge tone={issue.severity === 'ERROR' ? 'danger' : 'warn'}>
                      {issue.severity === 'ERROR' ? 'Error' : 'Warn'}
                    </Badge>
                    <span className="text-xs text-ink-700">{issue.message}</span>
                  </li>
                ))}
              </ul>
              {readiness.issues.length > 12 && (
                <p className="px-4 py-2 text-2xs text-ink-400">+{readiness.issues.length - 12} more</p>
              )}
            </Card>
          )}

          {completeness.missing.length > 0 && (
            <Card title="Missing information">
              <ul className="flex flex-wrap gap-1 px-4 py-2">
                {completeness.missing.slice(0, 20).map((item) => (
                  <li key={item.field}>
                    <Badge tone={item.severity === 'REQUIRED' ? 'warn' : 'neutral'}>{item.label}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {userCan(user, 'product.status.change') && (
            <Card title="Move status">
              <div className="flex flex-col gap-2 px-4 py-3">
                {transitions.length === 0 && <p className="text-xs text-ink-400">No transitions available.</p>}
                {transitions.map((rule) => (
                  <ActionForm key={rule.to} action={changeStatusAction} className="flex flex-col gap-1.5">
                    <input type="hidden" name="product_id" value={product.id} />
                    <input type="hidden" name="status" value={rule.to} />
                    {rule.requiresComment && (
                      <textarea
                        className="field field-sm"
                        name="comment"
                        rows={2}
                        placeholder="Reason (required)"
                        required
                      />
                    )}
                    <button
                      type="submit"
                      className={`btn btn-sm ${rule.check.allowed ? (rule.tone === 'primary' ? 'btn-primary' : rule.tone === 'danger' ? 'btn-danger' : '') : ''}`}
                      disabled={!rule.check.allowed}
                      title={rule.check.reason}
                    >
                      {rule.label}
                    </button>
                    {!rule.check.allowed && rule.check.reason && (
                      <p className="text-2xs text-ink-400">{rule.check.reason}</p>
                    )}
                  </ActionForm>
                ))}
              </div>
            </Card>
          )}

          {userCan(user, 'product.archive') && (
            <Card title="Archive">
              <ActionForm action={archiveAction} className="px-4 py-3">
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="archived" value={product.is_archived ? '0' : '1'} />
                <button className="btn btn-sm w-full" type="submit">
                  {product.is_archived ? 'Restore to draft' : 'Archive product'}
                </button>
              </ActionForm>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
