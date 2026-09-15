'use client';

import { useActionState } from 'react';
import { loginAction } from '@/app/actions/auth';
import { Field } from '@/components/ui';

export function LoginFields() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field label="Email">
        <input className="field" type="email" name="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password">
        <input className="field" type="password" name="password" autoComplete="current-password" required />
      </Field>
      {state?.error && (
        <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{state.error}</p>
      )}
      <button className="btn btn-primary mt-1" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
