import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isInitialized } from '@/lib/bootstrap';
import { getSetting } from '@/lib/settings';
import { LoginFields } from './login-fields';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  if (!isInitialized()) redirect('/setup');
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
  const { reason } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">HOKK</p>
          <h1 className="text-xl font-semibold tracking-tight">{getSetting('brand.name')}</h1>
          <p className="text-xs text-ink-500">{getSetting('brand.tagline')}</p>
        </div>

        <form className="card flex flex-col gap-3 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Product Operations System</p>
          {reason === 'password-changed' && (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
              Password changed. Sign in with your new password.
            </p>
          )}
          <LoginFields />
        </form>

        <p className="mt-4 text-center text-2xs text-ink-400">Internal tool. Accounts are created by a Super Admin.</p>
      </div>
    </main>
  );
}
