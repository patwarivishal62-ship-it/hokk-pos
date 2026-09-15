/**
 * Role-based access control.
 *
 * Permissions are a flat catalogue of dotted keys stored on each Role row as a
 * JSON array, so new roles can be created at runtime from the UI without a
 * code change (spec §4). The frontend never hard-codes role names — it asks
 * `can(user, 'product.export')`.
 *
 * The wildcard "*" grants everything (used by SUPER_ADMIN).
 */

export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDefinition[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'catalog',
    label: 'Catalog',
    permissions: [
      { key: 'product.view', label: 'View products', description: 'Read catalog and product detail pages.' },
      { key: 'product.create', label: 'Create products', description: 'Add new products and generate SKUs.' },
      { key: 'product.edit', label: 'Edit products', description: 'Change classification, specifications, pricing, variants.' },
      { key: 'product.delete', label: 'Delete products', description: 'Permanently remove a product record.' },
      { key: 'product.archive', label: 'Archive products', description: 'Archive / unarchive products.' },
      { key: 'product.sku.edit', label: 'Edit SKU', description: 'Modify the primary identifier after creation.' },
      { key: 'product.status.change', label: 'Move workflow status', description: 'Advance or return products through the lifecycle.' },
      { key: 'product.assign', label: 'Assign work', description: 'Assign products and tasks to team members.' },
      { key: 'product.bulk', label: 'Bulk operations', description: 'Run bulk actions across many products.' },
    ],
  },
  {
    key: 'content',
    label: 'Content & naming',
    permissions: [
      { key: 'content.edit', label: 'Edit content', description: 'Names, descriptions, stories, craft, care, SEO copy.' },
      { key: 'name.propose', label: 'Propose names', description: 'Submit product name proposals for approval.' },
      { key: 'name.approve', label: 'Approve names', description: 'Accept or reject a proposed product name.' },
      { key: 'comment.create', label: 'Comment', description: 'Post internal comments and mentions.' },
    ],
  },
  {
    key: 'media',
    label: 'Photography',
    permissions: [
      { key: 'image.upload', label: 'Upload images', description: 'Add images to Original / Final folders.' },
      { key: 'image.edit', label: 'Edit image metadata', description: 'Alt text, slot assignment, ordering, primary flag.' },
      { key: 'image.delete', label: 'Delete images', description: 'Remove images from a product.' },
      { key: 'image.approve', label: 'Approve images', description: 'Mark photography assets as approved.' },
    ],
  },
  {
    key: 'review',
    label: 'Review & approval',
    permissions: [
      { key: 'product.review', label: 'Review products', description: 'Run the review checklist and leave decisions.' },
      { key: 'product.approve', label: 'Approve products', description: 'Approve a product for Shopify readiness.' },
      { key: 'product.reject', label: 'Reject / request changes', description: 'Reject or send a product back with a reason.' },
    ],
  },
  {
    key: 'shopify',
    label: 'Shopify & export',
    permissions: [
      { key: 'export.view', label: 'View exports', description: 'See export history and previews.' },
      { key: 'export.run', label: 'Run exports', description: 'Generate and download Shopify CSV / Excel workbooks.' },
      { key: 'export.configure', label: 'Configure export mapping', description: 'Change the Shopify column mapping and schema version.' },
      { key: 'import.view', label: 'View imports', description: 'See import runs and row validation.' },
      { key: 'import.run', label: 'Run imports', description: 'Upload and import existing catalog files.' },
    ],
  },
  {
    key: 'config',
    label: 'Configuration',
    permissions: [
      { key: 'taxonomy.category.manage', label: 'Manage categories', description: 'Create / edit / archive product categories.' },
      { key: 'taxonomy.culture.manage', label: 'Manage handloom cultures', description: 'Create / edit / archive weave cultures.' },
      { key: 'taxonomy.collection.manage', label: 'Manage collections', description: 'Create / edit / archive / reorder collections.' },
      { key: 'sizeguide.manage', label: 'Manage size guides', description: 'Size guides and custom measurement columns.' },
      { key: 'attribute.manage', label: 'Manage attribute schema', description: 'Dynamic product attributes per product type.' },
      { key: 'settings.manage', label: 'Manage settings', description: 'SKU pattern, units, storage, Shopify configuration.' },
    ],
  },
  {
    key: 'people',
    label: 'People & audit',
    permissions: [
      { key: 'user.view', label: 'View users', description: 'See the team directory.' },
      { key: 'user.manage', label: 'Manage users', description: 'Invite, deactivate, reset passwords, change roles.' },
      { key: 'role.manage', label: 'Manage roles', description: 'Create roles and edit their permissions.' },
      { key: 'audit.view', label: 'View audit log', description: 'Read the full change history.' },
    ],
  },
];

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

export function permissionLabel(key: string): string {
  for (const group of PERMISSION_GROUPS) {
    const found = group.permissions.find((p) => p.key === key);
    if (found) return found.label;
  }
  return key;
}

// ---------------------------------------------------------------------------
// Default role definitions (seeded; editable at runtime)
// ---------------------------------------------------------------------------

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  sortOrder: number;
}

const VIEW_ONLY = ['product.view'];

export const DEFAULT_ROLES: RoleSeed[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full access to every area of the system, including users, roles, settings and exports.',
    permissions: ['*'],
    sortOrder: 10,
  },
  {
    key: 'ADMIN',
    name: 'Admin / Operations Manager',
    description: 'Owns the catalog: creates and edits products, assigns work, manages collections and runs exports.',
    permissions: [
      'product.view', 'product.create', 'product.edit', 'product.archive', 'product.status.change',
      'product.assign', 'product.bulk', 'product.sku.edit',
      'content.edit', 'name.propose', 'name.approve', 'comment.create',
      'image.upload', 'image.edit', 'image.delete', 'image.approve',
      'product.review',
      'export.view', 'export.run', 'import.view', 'import.run',
      'taxonomy.category.manage', 'taxonomy.culture.manage', 'taxonomy.collection.manage',
      'sizeguide.manage', 'attribute.manage',
      'user.view', 'audit.view',
    ],
    sortOrder: 20,
  },
  {
    key: 'CONTENT',
    name: 'Content Team',
    description: 'Writes names, descriptions, stories, craft and SEO copy. Cannot delete products or export.',
    permissions: [
      'product.view', 'content.edit', 'name.propose', 'comment.create', 'product.status.change',
    ],
    sortOrder: 30,
  },
  {
    key: 'PHOTOGRAPHY',
    name: 'Photography / Creative',
    description: 'Uploads and organises product imagery against the required image slots.',
    permissions: ['product.view', 'image.upload', 'image.edit', 'comment.create'],
    sortOrder: 40,
  },
  {
    key: 'REVIEWER',
    name: 'Reviewer',
    description: 'Runs the product review checklist and approves, rejects or requests changes.',
    permissions: ['product.view', 'product.review', 'product.approve', 'product.reject', 'comment.create'],
    sortOrder: 50,
  },
  {
    key: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access to the catalog.',
    permissions: [...VIEW_ONLY],
    sortOrder: 60,
  },
];

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export function hasPermission(granted: string[], permission: string): boolean {
  if (!granted || granted.length === 0) return false;
  if (granted.includes('*')) return true;
  if (granted.includes(permission)) return true;
  // Prefix grants: "taxonomy.*" covers "taxonomy.category.manage".
  const parts = permission.split('.');
  for (let depth = parts.length - 1; depth >= 1; depth -= 1) {
    if (granted.includes(`${parts.slice(0, depth).join('.')}.*`)) return true;
  }
  return false;
}

export function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface PermissionSubject {
  permissions: string[];
}

export function can(subject: PermissionSubject | null | undefined, permission: string): boolean {
  if (!subject) return false;
  return hasPermission(subject.permissions, permission);
}
