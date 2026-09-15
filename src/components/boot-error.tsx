import type { ReactNode } from 'react';
import type { BootFailure } from '@/lib/boot-check';

/**
 * Friendly full-page replacement for Next.js's "Application error" digest
 * screen when the deployment is misconfigured (missing database / secrets).
 * Static markup only — must never touch the database or session.
 */

/** Renders `backtick` spans as inline code; everything else as plain text. */
function renderStep(step: string): ReactNode {
  const parts = step.split('`');
  if (parts.length === 1) return step;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs text-ink-900">
        {part}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function BootErrorScreen({ failure }: { failure: BootFailure }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-10">
      <div className="w-full max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">HOKK · Action needed</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{failure.title}</h1>
        <p className="mt-1 text-sm text-ink-600">{failure.intro}</p>
        <ol className="card mt-4 flex list-decimal flex-col gap-2 p-5 pl-10 text-sm leading-relaxed text-ink-800">
          {failure.steps.map((step) => (
            <li key={step}>{renderStep(step)}</li>
          ))}
        </ol>
        {failure.detail ? (
          <details className="mt-3 text-xs text-ink-500">
            <summary className="cursor-pointer underline">Technical details</summary>
            <pre className="mt-2 overflow-x-auto rounded border border-ink-200 bg-white p-3 font-mono text-2xs text-ink-600">
              {failure.detail}
            </pre>
          </details>
        ) : null}
        <p className="mt-4 text-2xs text-ink-400">
          Nothing is broken — the app just needs its database connection. Reload this page after completing the steps
          above.
        </p>
      </div>
    </main>
  );
}
