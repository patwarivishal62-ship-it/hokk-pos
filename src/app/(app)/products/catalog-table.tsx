'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { bulkAction, type ActionResult } from '@/app/actions/products';
import { Meter, ReadinessBadge, StatusBadge, formatDateTime } from '@/components/ui';
import type { ProductRow } from '@/lib/types';

interface Option {
  id: string;
  name: string;
}

interface Props {
  rows: ProductRow[];
  total: number;
  offset: number;
  limit: number;
  canBulk: boolean;
  users: Option[];
  categories: Option[];
  cultures: Option[];
  collections: Option[];
  statuses: Array<{ value: string; label: string }>;
  queryString: string;
}

export function CatalogTable(props: Props) {
  const { rows, canBulk, users, categories, cultures, collections, statuses, queryString, total, offset, limit } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, formAction, pending] = useActionState(bulkAction, null);
  const [bulkKind, setBulkKind] = useState('status');

  // Selection is page-scoped; clear it when the page changes.
  useEffect(() => {
    setSelected(new Set());
  }, [queryString]);

  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const needsValue = ['status', 'assign', 'category', 'culture', 'collection', 'tags', 'field'].includes(bulkKind);

  return (
    <form action={formAction} className="card flex flex-col">
      <input type="hidden" name="ids" value={[...selected].join(',')} />
      <input type="hidden" name="bulk" value={bulkKind} />

      <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-3 py-2">
        <label className="flex items-center gap-1.5 text-2xs">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!canBulk || ids.length === 0}
            onChange={() => setSelected(allSelected ? new Set() : new Set(ids))}
          />
          Select all
        </label>
        <span className="text-2xs text-ink-500">{selected.size} selected</span>

        {canBulk && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <select className="field field-sm w-40" value={bulkKind} onChange={(event) => setBulkKind(event.target.value)}>
              <option value="status">Change status</option>
              <option value="assign">Assign team member</option>
              <option value="category">Assign category</option>
              <option value="culture">Assign handloom culture</option>
              <option value="collection">Add to collection</option>
              <option value="tags">Add tags</option>
              <option value="field">Update field</option>
              <option value="request_review">Request review</option>
              <option value="recompute">Recompute scores</option>
              <option value="archive">Archive</option>
            </select>

            {bulkKind === 'status' && (
              <select className="field field-sm w-44" name="value" required>
                <option value="">Status…</option>
                {statuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            )}
            {bulkKind === 'assign' && (
              <select className="field field-sm w-44" name="value" required>
                <option value="">Team member…</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            )}
            {bulkKind === 'category' && (
              <select className="field field-sm w-44" name="value" required>
                <option value="">Category…</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            {bulkKind === 'culture' && (
              <select className="field field-sm w-44" name="value" required>
                <option value="">Culture…</option>
                {cultures.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            {bulkKind === 'collection' && (
              <select className="field field-sm w-44" name="value" required>
                <option value="">Collection…</option>
                {collections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            {(bulkKind === 'tags' || bulkKind === 'field') && (
              <input
                className="field field-sm w-44"
                name="value"
                placeholder={bulkKind === 'tags' ? 'festive, cotton' : 'value'}
                required
              />
            )}
            {bulkKind === 'field' && (
              <select className="field field-sm w-40" name="field" required>
                <option value="">Field…</option>
                <option value="colour">Colour</option>
                <option value="fabric">Fabric</option>
                <option value="currency">Currency</option>
                <option value="vendor">Vendor</option>
                <option value="season">Season</option>
                <option value="occasion">Occasion</option>
                <option value="gender">Gender</option>
                <option value="country_of_origin">Country of origin</option>
              </select>
            )}

            <button className="btn btn-sm btn-primary" type="submit" disabled={pending || selected.size === 0 || (needsValue === false && false)}>
              {pending ? 'Applying…' : 'Apply'}
            </button>
          </div>
        )}
      </div>

      {state && (
        <p
          className={`border-b px-3 py-1.5 text-xs ${
            state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {state.ok ? state.message : state.error}
        </p>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {canBulk && <th className="w-8" />}
              <th>SKU</th>
              <th>Product</th>
              <th>Category</th>
              <th>Culture</th>
              <th>Status</th>
              <th>Complete</th>
              <th>Photos</th>
              <th>Shopify</th>
              <th>Assigned</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {canBulk && (
                  <td>
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.sku}`} />
                  </td>
                )}
                <td className="mono whitespace-nowrap">
                  <Link href={`/products/${row.id}`} className="text-brand hover:underline">
                    {row.sku}
                  </Link>
                </td>
                <td>
                  <Link href={`/products/${row.id}`} className="block max-w-[22rem] truncate hover:underline">
                    {row.name ?? <em className="text-ink-400">Unnamed product</em>}
                  </Link>
                  {row.handle && <span className="mono text-2xs text-ink-400">/{row.handle}</span>}
                </td>
                <td className="text-xs text-ink-600">{row.category_name ?? '—'}</td>
                <td className="text-xs text-ink-600">{row.culture_name ?? '—'}</td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
                <td className="w-28">
                  <div className="flex items-center gap-1.5">
                    <Meter value={row.completeness_score} />
                    <span className="w-8 text-right text-2xs text-ink-500">{row.completeness_score}%</span>
                  </div>
                </td>
                <td className="whitespace-nowrap text-xs">
                  {row.photography_required > 0 ? (
                    <span className={row.photography_complete < row.photography_required ? 'text-amber-700' : 'text-emerald-700'}>
                      {row.photography_complete}/{row.photography_required}
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </td>
                <td>
                  <ReadinessBadge state={row.readiness_state} />
                </td>
                <td className="text-xs text-ink-600">{row.assignee_name ?? <span className="text-ink-300">Unassigned</span>}</td>
                <td className="whitespace-nowrap text-2xs text-ink-500">{formatDateTime(row.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-ink-200 px-3 py-2 text-xs text-ink-500">
        <span>
          Showing {rows.length === 0 ? 0 : offset + 1}–{Math.min(total, offset + rows.length)} of {total}
        </span>
        <div className="flex items-center gap-1">
          {offset > 0 && (
            <Link className="btn btn-sm" href={`?${withOffset(queryString, Math.max(0, offset - limit))}`}>
              Previous
            </Link>
          )}
          {offset + limit < total && (
            <Link className="btn btn-sm" href={`?${withOffset(queryString, offset + limit)}`}>
              Next
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}

function withOffset(queryString: string, offset: number): string {
  const params = new URLSearchParams(queryString);
  if (offset === 0) params.delete('offset');
  else params.set('offset', String(offset));
  return params.toString();
}
