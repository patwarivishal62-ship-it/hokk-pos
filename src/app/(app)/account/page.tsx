import { requireUser } from '@/lib/auth';
import { all, get } from '@/lib/db';
import { Badge, Card, PageHeader, StatusBadge, formatDateTime } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { changeMyPasswordAction } from '@/app/actions/people';
import { logoutAction } from '@/app/actions/auth';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireUser();
  const profile = get<{ email: string; name: string; job_title: string | null; created_at: string; last_login_at: string | null }>(
    'SELECT email, name, job_title, created_at, last_login_at FROM "user" WHERE id = ?',
    [user.id],
  );
  const assigned = get<{ n: number }>('SELECT COUNT(*) AS n FROM product WHERE assignee_id = ? AND is_archived = 0', [user.id])?.n ?? 0;
  const tasks = all<{ id: string; task_type: string; status: string; sku: string; title: string | null }>(
    `SELECT a.id, a.task_type, a.status, p.sku, p.name AS title FROM assignment a
     JOIN product p ON p.id = a.product_id
     WHERE a.user_id = ? AND a.status IN ('PENDING','IN_PROGRESS') ORDER BY a.created_at DESC LIMIT 10`,
    [user.id],
  );
  const comments = all<{ id: string; sku: string; title: string | null; created_at: string }>(
    `SELECT c.id, p.sku, p.name AS title, c.created_at FROM comment c
     JOIN product p ON p.id = c.product_id
     WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 5`,
    [user.id],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My account"
        subtitle={profile?.email ?? user.email}
        actions={
          <form action={logoutAction}>
            <button className="btn" type="submit">
              Sign out
            </button>
          </form>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <dl className="flex flex-col divide-y divide-ink-100 px-4 py-3 text-sm">
            <Row label="Name" value={profile?.name ?? user.name} />
            <Row label="Email" value={profile?.email ?? user.email} />
            <Row label="Role" value={<Badge tone="neutral">{user.roleName ?? '—'}</Badge>} />
            <Row label="Job title" value={profile?.job_title ?? '—'} />
            <Row label="Products assigned" value={assigned} />
            <Row label="Member since" value={profile ? formatDateTime(profile.created_at) : '—'} />
            <Row label="Last login" value={profile?.last_login_at ? formatDateTime(profile.last_login_at) : '—'} />
          </dl>
          <p className="border-t border-ink-200 px-4 py-2 text-2xs text-ink-400">
            Your permissions: <span className="mono">{user.permissions.slice(0, 12).join(', ')}{user.permissions.length > 12 ? '…' : ''}</span>.
            Ask an administrator to change your role.
          </p>
        </Card>

        <ActionForm action={changeMyPasswordAction}>
          <Card title="Change password">
            <div className="flex flex-col gap-3 px-4 py-3">
              <label>
                Current password <span className="text-red-600">*</span>
                <input className="field" type="password" name="current_password" required autoComplete="current-password" />
              </label>
              <label>
                New password <span className="text-red-600">*</span>
                <input className="field" type="password" name="new_password" required autoComplete="new-password" />
                <span className="text-2xs text-ink-400">At least 8 characters.</span>
              </label>
              <label>
                Confirm new password <span className="text-red-600">*</span>
                <input className="field" type="password" name="confirm_password" required autoComplete="new-password" />
              </label>
            </div>
            <div className="border-t border-ink-200 px-4 py-2.5">
              <button className="btn btn-sm btn-primary" type="submit">
                Change password
              </button>
            </div>
          </Card>
        </ActionForm>
      </div>

      <Card title="My open tasks">
        {tasks.length === 0 ? (
          <p className="px-4 py-3 text-xs text-ink-400">Nothing assigned to you right now.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-ink-100">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 px-4 py-2">
                <a href={`/products/${task.id}?tab=overview`} className="flex-1 text-sm text-brand hover:underline">
                  {task.title ?? task.sku}
                </a>
                <Badge tone="neutral">{task.task_type.toLowerCase().replace(/_/g, ' ')}</Badge>
                <Badge tone={task.status === 'IN_PROGRESS' ? 'info' : 'warn'}>{task.status.toLowerCase().replace(/_/g, ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent comments">
        {comments.length === 0 ? (
          <p className="px-4 py-3 text-xs text-ink-400">No comments yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-ink-100">
            {comments.map((comment) => (
              <li key={comment.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                <span className="flex-1">{comment.title ?? comment.sku}</span>
                <span className="text-2xs text-ink-400">{formatDateTime(comment.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-xs uppercase tracking-wider text-ink-500">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
