import Link from 'next/link';
import type { ReactNode } from 'react';
import { STATUS_LABELS, STATUS_TONE, type ProductStatus, type ReadinessState } from '@/lib/types';

type Tone = 'neutral' | 'info' | 'warn' | 'danger' | 'success';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: ProductStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</Badge>;
}

export function ReadinessBadge({ state }: { state: ReadinessState }) {
  const tone: Tone = state === 'READY' ? 'success' : state === 'WARNINGS' ? 'warn' : 'danger';
  const label = state === 'READY' ? 'Ready' : state === 'WARNINGS' ? 'Warnings' : 'Blocked';
  return <Badge tone={tone}>{label}</Badge>;
}

export function Meter({ value, tone }: { value: number; tone?: 'auto' | Tone }) {
  const resolved: Tone =
    tone && tone !== 'auto' ? tone : value >= 90 ? 'success' : value >= 60 ? 'info' : value >= 30 ? 'warn' : 'danger';
  const color =
    resolved === 'success' ? 'bg-emerald-500' : resolved === 'info' ? 'bg-blue-500' : resolved === 'warn' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="meter" aria-hidden>
      <span className={color} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && !error && <p className="text-2xs text-ink-400">{hint}</p>}
      {error && <p className="text-2xs text-red-600">{error}</p>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {body && <p className="max-w-md text-xs text-ink-500">{body}</p>}
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200 pb-3">
      <div className="flex flex-col gap-0.5">
        <h1>{title}</h1>
        {subtitle && <p className="text-xs text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  hrefFor,
}: {
  total: number;
  limit: number;
  offset: number;
  hrefFor: (offset: number) => string;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-ink-200 px-3 py-2 text-xs text-ink-500">
      <span>
        Showing {offset + 1}–{Math.min(total, offset + limit)} of {total}
      </span>
      <div className="flex items-center gap-1">
        {offset > 0 && (
          <Link className="btn btn-sm" href={hrefFor(Math.max(0, offset - limit))}>
            Previous
          </Link>
        )}
        <span className="px-2">
          Page {page} / {pages}
        </span>
        {offset + limit < total && (
          <Link className="btn btn-sm" href={hrefFor(offset + limit)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

export function StatRow({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink-100 py-1.5 last:border-0">
      <span className="text-xs text-ink-500">{label}</span>
      <span className={`text-sm font-medium ${tone === 'danger' ? 'text-red-700' : tone === 'success' ? 'text-emerald-700' : 'text-ink-900'}`}>
        {value}
      </span>
    </div>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
