'use client';

import { useActionState } from 'react';
import { runImportAction } from '@/app/actions/imports';
import { Card } from '@/components/ui';
import type { ImportTarget } from '@/lib/importer';

export function ImportPreview({
  previewId,
  mode,
  summary,
  targets,
  columns,
  mapping,
}: {
  previewId: string;
  mode: string;
  summary: { total: number; valid: number; invalid: number; duplicates: number; newProducts: number; updates: number };
  targets: ImportTarget[];
  columns: string[];
  mapping: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(runImportAction, null);

  return (
    <Card
      title="Map columns & validate"
      action={<span className="text-2xs text-ink-400">{columns.length} columns detected</span>}
    >
      {/* One form: the mapping selects submit together with the run controls,
          because runImportAction reads map:* values from the same FormData. */}
      <form action={action} className="flex flex-col gap-3 px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {targets.map((target) => (
            <label key={target.key} className="text-xs">
              <span className="text-ink-600">{target.label}</span>
              <select className="field field-sm" name={`map:${target.key}`} defaultValue={mapping[target.key] ?? ''}>
                <option value="">— not mapped —</option>
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Stat label="Rows" value={summary.total} />
          <Stat label="Valid" value={summary.valid} tone="text-emerald-700" />
          <Stat label="Invalid" value={summary.invalid} tone="text-red-700" />
          <Stat label="Duplicates" value={summary.duplicates} tone="text-amber-700" />
          <Stat label="New" value={summary.newProducts} />
          <Stat label="Updates" value={summary.updates} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-200 pt-2.5">
          <input type="hidden" name="preview_id" value={previewId} />
          <label className="flex items-center gap-1.5 text-xs normal-case">
            <input type="checkbox" name="skip_duplicates" value="1" defaultChecked />
            Skip flagged duplicates
          </label>
          <button className="btn btn-sm btn-primary" type="submit" disabled={pending || summary.valid === 0}>
            {pending ? 'Importing…' : `Import ${summary.valid} row(s)`}
          </button>
          <span className="text-2xs text-ink-400">Mode: {mode}</span>
          {state && (
            <span className={`text-xs ${state.ok ? 'text-emerald-700' : 'text-red-600'}`}>
              {state.ok ? state.message : state.error}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`text-lg font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
