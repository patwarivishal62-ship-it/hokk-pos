import { requireUser } from '@/lib/auth';
import { getBoolean } from '@/lib/settings';
import { Card, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { changeMyPasswordAction } from '@/app/actions/people';

export const dynamic = 'force-dynamic';

export default async function PasswordPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={user.mustChangePassword ? 'Set a new password' : 'Change password'}
        subtitle={
          user.mustChangePassword
            ? 'An administrator set a temporary password for this account. Choose your own before continuing.'
            : 'Choose a new password for your account.'
        }
      />

      <div className="max-w-lg">
        <ActionForm action={changeMyPasswordAction}>
          <Card title="Password">
            <div className="flex flex-col gap-3 px-4 py-3">
              <label>
                Current password <span className="text-red-600">*</span>
                <input className="field" type="password" name="current_password" required autoComplete="current-password" />
              </label>
              <label>
                New password <span className="text-red-600">*</span>
                <input className="field" type="password" name="new_password" required autoComplete="new-password" />
                <span className="text-2xs text-ink-400">At least 8 characters, and it must contain a letter and a number.</span>
              </label>
              <label>
                Confirm new password <span className="text-red-600">*</span>
                <input className="field" type="password" name="confirm_password" required autoComplete="new-password" />
              </label>
            </div>
            <div className="flex items-center justify-between border-t border-ink-200 px-4 py-2.5">
              <span className="text-2xs text-ink-400">
                {getBoolean('security.force_password_change', true)
                  ? 'You will be signed back into the app automatically.'
                  : 'Other sessions stay signed in.'}
              </span>
              <button className="btn btn-primary btn-sm" type="submit">
                Update password
              </button>
            </div>
          </Card>
        </ActionForm>
      </div>
    </div>
  );
}
