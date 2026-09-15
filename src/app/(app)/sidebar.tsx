'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
}
export interface NavSection {
  label: string;
  items: NavItem[];
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname() ?? '';
  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-400">{section.label}</p>
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link ${isActive(pathname, item.href) ? 'nav-link-active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function MobileNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname() ?? '';
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-ink-200 bg-white px-2 py-1.5 md:hidden">
      {sections
        .flatMap((section) => section.items)
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded px-2 py-1 text-xs ${
              isActive(pathname, item.href) ? 'bg-ink-900 text-white' : 'text-ink-600'
            }`}
          >
            {item.label}
          </Link>
        ))}
    </nav>
  );
}
