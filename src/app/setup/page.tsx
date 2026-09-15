import { redirect } from 'next/navigation';
import { isInitialized } from '@/lib/bootstrap';
import { SetupFields } from './setup-fields';

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  if (isInitialized()) redirect('/login');

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">HOKK</p>
          <h1 className="text-xl font-semibold tracking-tight">Set up the Product Operations System</h1>
          <p className="mt-1 text-xs text-ink-500">
            First run. This creates the roles, settings, photography templates and attribute schema, then signs you in as
            Super Admin. No catalog data is created.
          </p>
        </div>
        <SetupFields
          defaults={{
            name: process.env.SEED_ADMIN_NAME ?? '',
            email: process.env.SEED_ADMIN_EMAIL ?? '',
          }}
        />
        <p className="mt-4 text-2xs text-ink-400">
          Roles created: Super Admin, Admin / Operations, Content, Photography, Reviewer, Viewer. Permissions are editable
          later under Settings → Roles.
        </p>
      </div>
    </main>
  );
}
