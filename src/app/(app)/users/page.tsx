import { requirePermission, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader, formatDateTime } from '@/components/ui';
import { ActionForm, ConfirmSubmit } from '@/components/action-form';
import { resetUserPasswordAction, saveUserAction, setUserStatusAction } from '@/app/actions/people';

export const dynamic = 'force-dynamic';

interface UserRow {
  id: string;
  email: string;
  name: string;
  is_active: number;
  must_change_password: number;
  job_title: string | null;
  role_key: string | null;
  role_name: string | null;
  last_login_at: string | null;
  created_at: string;
  open_tasks: number;
  assigned: number;
}

export default async function UsersPage() {
  const user = await requirePermission('user.view');
  const canManage = userCan(user, 'user.manage');
  const users = all<UserRow>(
    `SELECT u.id, u.email, u.name, u.is_active, u.must_change_password, u.job_title, u.role_key, r.name AS role_name,
            u.last_login_at, u.created_at,
            (SELECT COUNT(*) FROM assignment a WHERE a.user_id = u.id AND a.status IN ('PENDING','IN_PROGRESS')) AS open_tasks,
            (SELECT COUNT(*) FROM product p WHERE p.assignee_id = u.id AND p.is_archived = 0) AS assigned
     FROM "user" u LEFT JOIN role r ON r.key = u.role_key ORDER BY u.name`,
  );
  const roles = all<{ key: string; name: string }>('SELECT key, name FROM role ORDER BY sort_order, name');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Users" subtitle="Access is controlled entirely by role. Roles are editable — nothing here is hard-coded." />

      <Card title={`Team (${users.length})`}>
        {users.length === 0 ? (
          <EmptyState title="No users" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Job title</th>
                  <th>Assigned</th>
                  <th>Open tasks</th>
                  <th>Status</th>
                  <th>Last login</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id} className={row.is_active === 0 ? 'opacity-50' : ''}>
                    <td className="font-medium">
                      {row.name}
                      {row.role_key === 'SUPER_ADMIN' && <span className="ml-1 text-2xs text-ink-400">(super admin)</span>}
                    </td>
                    <td className="text-xs">{row.email}</td>
                    <td>{row.role_name ? <Badge tone="neutral">{row.role_name}</Badge> : <span className="text-ink-300">—</span>}</td>
                    <td className="text-xs text-ink-500">{row.job_title ?? '—'}</td>
                    <td className="text-center">{row.assigned}</td>
                    <td className="text-center">{row.open_tasks}</td>
                    <td>
                      <Badge tone={row.is_active === 1 ? 'success' : 'neutral'}>{row.is_active === 1 ? 'active' : 'inactive'}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-2xs text-ink-500">
                      {row.last_login_at ? formatDateTime(row.last_login_at) : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={saveUserAction}>
            <Card title="Add user" action={<span className="text-2xs text-ink-400">Accounts are invite-only</span>}>
              <div className="flex flex-col gap-3 px-4 py-3">
                <label>
                  Full name <span className="text-red-600">*</span>
                  <input className="field" name="name" required placeholder="Ananya Rao" />
                </label>
                <label>
                  Email <span className="text-red-600">*</span>
                  <input className="field" name="email" type="email" required placeholder="ananya@hokk.in" />
                </label>
                <label>
                  Role <span className="text-red-600">*</span>
                  <select className="field" name="role_id" required defaultValue="">
                    <option value="" disabled>
                      Choose a role…
                    </option>
                    {roles.map((role) => (
                      <option key={role.key} value={role.key}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Job title
                  <input className="field" name="job_title" placeholder="Content writer" />
                </label>
                <label>
                  Phone
                  <input className="field" name="phone" />
                </label>
                <label>
                  Initial password <span className="text-red-600">*</span>
                  <input className="field" name="password" type="text" required />
                  <span className="text-2xs text-ink-400">
                    At least 8 characters. The user is asked to change it on first sign-in.
                  </span>
                </label>
              </div>
              <div className="border-t border-ink-200 px-4 py-2.5">
                <button className="btn btn-primary btn-sm" type="submit">
                  Add user
                </button>
              </div>
            </Card>
          </ActionForm>

          <div className="flex flex-col gap-4">
            {users.map((row) => (
              <Card key={row.id} title={`${row.name} · ${row.email}`}>
                <ActionForm action={saveUserAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                    <label>
                      Name
                      <input className="field" name="name" defaultValue={row.name} required />
                    </label>
                    <label>
                      Email
                      <input className="field" name="email" type="email" defaultValue={row.email} required />
                    </label>
                    <label>
                      Role
                      <select className="field" name="role_key" defaultValue={row.role_key ?? ''} disabled={row.role_key === 'SUPER_ADMIN'}>
                        {roles.map((role) => (
                          <option key={role.key} value={role.key}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Job title
                      <input className="field" name="job_title" defaultValue={row.job_title ?? ''} />
                    </label>
                  </div>
                  <div className="flex items-center gap-2 border-t border-ink-200 px-4 py-2.5">
                    <button className="btn btn-sm btn-primary" type="submit">
                      Save
                    </button>
                    <span className="text-2xs text-ink-400">Joined {formatDateTime(row.created_at)}</span>
                  </div>
                </ActionForm>

                {row.role_key !== 'SUPER_ADMIN' && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-4 py-2.5">
                    <ActionForm action={setUserStatusAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="is_active" value={row.is_active === 1 ? '0' : '1'} />
                      <button className="btn btn-sm" type="submit">
                        {row.is_active === 1 ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </ActionForm>
                    <ActionForm action={resetUserPasswordAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={row.id} />
                      <input className="field field-sm w-40" name="password" placeholder="New password" />
                      <ConfirmSubmit label="Reset password" confirm="Reset this password? The user will be signed out." />
                    </ActionForm>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
