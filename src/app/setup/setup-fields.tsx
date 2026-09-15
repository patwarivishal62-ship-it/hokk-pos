'use client';

import { useActionState } from 'react';
import { setupAction } from '@/app/actions/auth';
import { Field } from '@/components/ui';

export function SetupFields({ defaults }: { defaults: { name: string; email: string } }) {
  const [state, formAction, pending] = useActionState(setupAction, null);
  return (
    <form action={formAction} className="card flex flex-col gap-3 p-5">
      <Field label="Your name">
        <input className="field" name="name" defaultValue={defaults.name} required minLength={2} />
      </Field>
      <Field label="Email" hint="This account becomes the Super Admin.">
        <input className="field" type="email" name="email" defaultValue={defaults.email} required />
      </Field>
      <Field label="Password" hint="At least 10 characters, with a letter, a number and a symbol.">
        <input className="field" type="password" name="password" required minLength={10} />
      </Field>
      <Field label="Confirm password">
        <input className="field" type="password" name="confirm" required minLength={10} />
      </Field>
      {state?.error && (
        <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{state.error}</p>
      )}
      <button className="btn btn-primary mt-1" type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create Super Admin'}
      </button>
    </form>
  );
}
