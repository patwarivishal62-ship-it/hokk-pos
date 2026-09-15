'use client';

import { useActionState, useRef, useState, type FormEvent, type ReactNode } from 'react';

export interface FormResult {
  ok: boolean;
  error?: string;
  message?: string;
  warnings?: string[];
}

type Action = (prev: FormResult | null, formData: FormData) => Promise<FormResult>;

/**
 * Wraps server-action forms so every mutation in the workspace reports its
 * result inline instead of silently reloading.
 */
export function ActionForm({
  action,
  children,
  className = '',
  onSubmit,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  onSubmit?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        onSubmit?.();
        // Clear the previous banner on resubmit.
        window.setTimeout(() => {}, 0);
      }}
    >
      {children}
      {state && (
        <div
          className={`mt-2 rounded border px-2.5 py-1.5 text-xs ${
            state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <p>{state.ok ? state.message : state.error}</p>
          {state.warnings && state.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-amber-800">
              {state.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {pending && <p className="mt-1 text-2xs text-ink-400">Working…</p>}
    </form>
  );
}

/** Simple confirm-then-submit button used by destructive actions. */
export function ConfirmSubmit({
  label,
  confirm,
  className = 'btn btn-sm btn-danger',
  name,
  value,
}: {
  label: string;
  confirm: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="submit"
        className={className}
        onClick={(event) => {
          if (!armed) {
            event.preventDefault();
            setArmed(true);
            window.setTimeout(() => setArmed(false), 3000);
          }
        }}
      >
        {armed ? 'Click to confirm' : label}
      </button>
      <span className="sr-only">{confirm}</span>
    </>
  );
}
