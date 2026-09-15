import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { isInitialized } from '@/lib/bootstrap';
import { getSetting } from '@/lib/settings';
import { initials } from '@/components/ui';
import { logoutAction } from '@/app/actions/auth';
import { MobileNav, SidebarNav, type NavSection } from './sidebar';

export const dynamic = 'force-dynamic';

const NAV: Array<{ label: string; items: Array<{ href: string; label: string; permission?: string }> }> = [
  {
    label: 'Work',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/products', label: 'Catalog' },
      { href: '/photography', label: 'Photography', permission: 'image.upload' },
      { href: '/content', label: 'Content', permission: 'content.edit' },
      { href: '/reviews', label: 'Reviews', permission: 'product.review' },
    ],
  },
  {
    label: 'Catalogue structure',
    items: [
      { href: '/collections', label: 'Collections' },
      { href: '/categories', label: 'Categories', permission: 'taxonomy.category.manage' },
      { href: '/cultures', label: 'Handloom cultures', permission: 'taxonomy.culture.manage' },
      { href: '/size-guides', label: 'Size guides', permission: 'sizeguide.manage' },
    ],
  },
  {
    label: 'Shopify',
    items: [
      { href: '/exports', label: 'Exports', permission: 'export.view' },
      { href: '/imports', label: 'Imports', permission: 'import.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/users', label: 'Team', permission: 'user.view' },
      { href: '/roles', label: 'Roles', permission: 'role.manage' },
      { href: '/audit', label: 'Audit log', permission: 'audit.view' },
      { href: '/settings', label: 'Settings', permission: 'settings.manage' },
    ],
  },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!isInitialized()) redirect('/setup');
  const user = await requireUser();
  if (user.mustChangePassword) redirect('/account/password');

  const sections: NavSection[] = NAV.map((section) => ({
    label: section.label,
    items: section.items
      .filter((item) => !item.permission || hasPermission(user.permissions, item.permission))
      .map((item) => ({ href: item.href, label: item.label })),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-ink-200 bg-white md:flex">
        <div className="flex flex-col gap-0.5 border-b border-ink-200 px-3 py-3">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-brand">HOKK</p>
          <p className="truncate text-sm font-semibold tracking-tight">{getSetting('brand.name')}</p>
          <p className="text-2xs text-ink-400">Product Operations</p>
        </div>
        <SidebarNav sections={sections} />
        <div className="border-t border-ink-200 px-3 py-3">
          <Link href="/account" className="flex items-center gap-2 rounded px-1 py-1 hover:bg-ink-100">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-900 text-2xs font-semibold text-white">
              {initials(user.name)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium">{user.name}</span>
              <span className="truncate text-2xs text-ink-400">{user.roleName}</span>
            </span>
          </Link>
          <form action={logoutAction} className="mt-2">
            <button className="btn btn-sm w-full" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-2 md:hidden">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            HOKK POS
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/products" className="btn btn-sm">
              Catalog
            </Link>
            <form action={logoutAction}>
              <button className="btn btn-sm" type="submit">
                Out
              </button>
            </form>
          </div>
        </header>
        <MobileNav sections={sections} />
        <main className="flex-1 px-4 py-4 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
