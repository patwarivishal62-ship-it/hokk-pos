import { requirePermission, userCan } from '@/lib/auth';
import { all, parseJson } from '@/lib/db';
import { PERMISSION_GROUPS } from '@/lib/rbac';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionForm, ConfirmSubmit } from '@/components/action-form';
import { deleteRoleAction, saveRoleAction } from '@/app/actions/people';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const user = await requirePermission('role.manage');
  const canManage = userCan(user, 'role.manage');

  const rows = all<{
    key: string;
    name: string;
    description: string | null;
    permissions: string;
    is_system: number;
    user_count: number;
  }>(
    `SELECT r.*, (SELECT COUNT(*) FROM "user" u WHERE u.role_key = r.key) AS user_count FROM role r ORDER BY r.sort_order, r.name`,
  );
  const roles = parseRoles(rows);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Roles & permissions"
        subtitle="Permissions are data. Adding a new role requires no code change — the UI reads these rows."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((role) => (
          <ActionForm key={role.key} action={saveRoleAction}>
            <Card
              title={role.name}
              action={
                <span className="flex items-center gap-1.5">
                  <Badge tone={role.isSystem ? 'info' : 'neutral'}>{role.isSystem ? 'Built-in' : 'Custom'}</Badge>
                  <span className="text-2xs text-ink-400">{role.userCount} user(s)</span>
                </span>
              }
            >
              <input type="hidden" name="id" value={role.key} />
              <div className="flex flex-col gap-3 px-4 py-3">
                <label>
                  Name
                  <input className="field" name="name" defaultValue={role.name} required />
                </label>
                <label>
                  Description
                  <input className="field" name="description" defaultValue={role.description ?? ''} />
                </label>
                <label className="flex items-center gap-2 text-sm normal-case">
                  <input type="checkbox" name="wildcard" value="1" defaultChecked={role.wildcard} />
                  Full access (all permissions, including future ones)
                </label>
              </div>

              <div className="border-t border-ink-100 px-4 py-3">
                {PERMISSION_GROUPS.map((group) => (
                  <fieldset key={group.key} className="mb-3">
                    <legend className="text-2xs uppercase tracking-wider text-ink-500">{group.label}</legend>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {group.permissions.map((permission) => (
                        <label key={permission.key} className="flex items-center gap-2 text-xs normal-case">
                          <input
                            type="checkbox"
                            name="permissions"
                            value={permission.key}
                            defaultChecked={role.wildcard || role.permissions.includes(permission.key)}
                            disabled={role.wildcard}
                          />
                          <span className="flex flex-col">
                            <span>{permission.label}</span>
                            <span className="mono text-2xs text-ink-400">{permission.key}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-ink-200 px-4 py-2.5">
                <button className="btn btn-sm btn-primary" type="submit" disabled={!canManage}>
                  Save role
                </button>
                {!role.isSystem && (
                  <ActionForm action={deleteRoleAction}>
                    <input type="hidden" name="id" value={role.key} />
                    <ConfirmSubmit label="Delete" confirm={`Delete the “${role.name}” role?`} />
                  </ActionForm>
                )}
              </div>
            </Card>
          </ActionForm>
        ))}

        {canManage && (
          <ActionForm action={saveRoleAction}>
            <Card title="New role">
              <div className="flex flex-col gap-3 px-4 py-3">
                <label>
                  Name <span className="text-red-600">*</span>
                  <input className="field" name="name" required placeholder="Merchandiser" />
                </label>
                <label>
                  Description
                  <input className="field" name="description" placeholder="Prices and inventory only" />
                </label>
                <p className="text-2xs text-ink-400">
                  Create the role, then tick its permissions in the card that appears above.
                </p>
              </div>
              <div className="border-t border-ink-200 px-4 py-2.5">
                <button className="btn btn-sm btn-primary" type="submit">
                  Create role
                </button>
              </div>
            </Card>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

function parseRoles(rows: Array<{
  key: string;
  name: string;
  description: string | null;
  permissions: string;
  is_system: number;
  user_count: number;
}>) {
  return rows.map((row) => {
    const permissions = parseJson<string[]>(row.permissions, []);
    return {
      key: row.key,
      name: row.name,
      description: row.description,
      permissions,
      wildcard: permissions.includes('*'),
      isSystem: row.is_system === 1,
      userCount: row.user_count,
    };
  });
}
