import type { ReactNode } from 'react';
import { Field } from '@/components/ui';

export function TextField({
  name,
  label,
  value,
  placeholder,
  hint,
  disabled,
  className = '',
  type = 'text',
}: {
  name: string;
  label: string;
  value?: string | number | null;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  type?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input
        className="field"
        type={type}
        name={name}
        defaultValue={value === null || value === undefined ? '' : String(value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </Field>
  );
}

export function TextAreaField({
  name,
  label,
  value,
  rows = 4,
  hint,
  placeholder,
  disabled,
  className = '',
  maxLength,
}: {
  name: string;
  label: string;
  value?: string | null;
  rows?: number;
  hint?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxLength?: number;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <textarea
        className="field"
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
      />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  value,
  options,
  placeholder = '—',
  hint,
  disabled,
  className = '',
}: {
  name: string;
  label: string;
  value?: string | null;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <select className="field" name={name} defaultValue={value ?? ''} disabled={disabled}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField({
  name,
  label,
  checked,
  hint,
  disabled,
  /** Tri-state columns (e.g. "blouse included") need an explicit value. */
  triStateValue,
}: {
  name: string;
  label: string;
  checked?: boolean | number | null;
  hint?: ReactNode;
  disabled?: boolean;
  triStateValue?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm normal-case">
      <input type="checkbox" name={name} defaultChecked={Boolean(checked)} disabled={disabled} value={triStateValue ?? 'on'} />
      <span className="flex flex-col">
        <span className="text-sm text-ink-800">{label}</span>
        {hint && <span className="text-2xs text-ink-400">{hint}</span>}
      </span>
    </label>
  );
}

export function MoneyField({
  name,
  label,
  value,
  currency,
  hint,
  disabled,
}: {
  name: string;
  label: string;
  value?: number | null;
  currency?: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex">
        {currency && (
          <span className="inline-flex items-center rounded-l border border-r-0 border-ink-200 bg-ink-50 px-2 text-xs text-ink-500">
            {currency}
          </span>
        )}
        <input
          className={`field ${currency ? 'rounded-l-none' : ''}`}
          type="number"
          step="0.01"
          min="0"
          name={name}
          defaultValue={value === null || value === undefined ? '' : String(value)}
          disabled={disabled}
        />
      </div>
    </Field>
  );
}

export function FormActions({ label = 'Save', disabled }: { label?: string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 border-t border-ink-200 px-4 py-2.5">
      <button className="btn btn-sm btn-primary" type="submit" disabled={disabled}>
        {label}
      </button>
    </div>
  );
}
