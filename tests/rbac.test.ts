import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  PERMISSION_GROUPS,
  can,
  hasPermission,
  parsePermissions,
  permissionLabel,
} from '@/lib/rbac';

const role = (key: string) => DEFAULT_ROLES.find((r) => r.key === key);
const perms = (key: string) => role(key)!.permissions;

describe('permission catalogue', () => {
  it('has unique keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('gives every permission a label', () => {
    for (const key of ALL_PERMISSIONS) {
      expect(permissionLabel(key)).not.toBe(key);
    }
  });

  it('groups permissions for the role editor UI', () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
    expect(grouped.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});

describe('evaluation', () => {
  it('supports the wildcard', () => {
    expect(hasPermission(['*'], 'product.delete')).toBe(true);
  });

  it('supports exact grants', () => {
    expect(hasPermission(['product.view'], 'product.view')).toBe(true);
    expect(hasPermission(['product.view'], 'product.delete')).toBe(false);
  });

  it('supports prefix grants', () => {
    expect(hasPermission(['taxonomy.*'], 'taxonomy.category.manage')).toBe(true);
    expect(hasPermission(['taxonomy.*'], 'product.view')).toBe(false);
  });

  it('denies when nothing is granted', () => {
    expect(hasPermission([], 'product.view')).toBe(false);
    expect(can(null, 'product.view')).toBe(false);
  });

  it('parses stored JSON safely', () => {
    expect(parsePermissions('["a","b"]')).toEqual(['a', 'b']);
    expect(parsePermissions('not json')).toEqual([]);
    expect(parsePermissions(null)).toEqual([]);
  });
});

describe('default roles match the brief (spec §4)', () => {
  it('super admin can do everything', () => {
    expect(can({ permissions: perms('SUPER_ADMIN') }, 'user.manage')).toBe(true);
    expect(can({ permissions: perms('SUPER_ADMIN') }, 'settings.manage')).toBe(true);
    expect(can({ permissions: perms('SUPER_ADMIN') }, 'export.configure')).toBe(true);
  });

  it('admin manages the catalog but not users or system settings', () => {
    const admin = { permissions: perms('ADMIN') };
    expect(can(admin, 'product.create')).toBe(true);
    expect(can(admin, 'product.assign')).toBe(true);
    expect(can(admin, 'export.run')).toBe(true);
    expect(can(admin, 'user.manage')).toBe(false);
    expect(can(admin, 'role.manage')).toBe(false);
    expect(can(admin, 'settings.manage')).toBe(false);
  });

  it('content can write copy but not delete or export', () => {
    const content = { permissions: perms('CONTENT') };
    expect(can(content, 'content.edit')).toBe(true);
    expect(can(content, 'name.propose')).toBe(true);
    expect(can(content, 'product.delete')).toBe(false);
    expect(can(content, 'product.sku.edit')).toBe(false);
    expect(can(content, 'export.run')).toBe(false);
    expect(can(content, 'image.upload')).toBe(false);
  });

  it('photography can upload but not edit copy', () => {
    const photo = { permissions: perms('PHOTOGRAPHY') };
    expect(can(photo, 'image.upload')).toBe(true);
    expect(can(photo, 'image.edit')).toBe(true);
    expect(can(photo, 'content.edit')).toBe(false);
    expect(can(photo, 'product.edit')).toBe(false);
  });

  it('reviewer can approve and reject but not edit data', () => {
    const reviewer = { permissions: perms('REVIEWER') };
    expect(can(reviewer, 'product.approve')).toBe(true);
    expect(can(reviewer, 'product.reject')).toBe(true);
    expect(can(reviewer, 'product.edit')).toBe(false);
    expect(can(reviewer, 'image.upload')).toBe(false);
  });

  it('viewer is read only', () => {
    const viewer = { permissions: perms('VIEWER') };
    expect(can(viewer, 'product.view')).toBe(true);
    expect(ALL_PERMISSIONS.filter((p) => p !== 'product.view' && can(viewer, p))).toEqual([]);
  });
});
