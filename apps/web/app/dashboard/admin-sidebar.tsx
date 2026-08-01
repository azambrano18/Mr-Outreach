'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { adminNavigation, isNavItemVisible, resolveActiveNavItem } from '../../lib/admin-navigation';
import { getInitials } from '../../lib/format';
import { BrandMark } from '../brand';

export function AdminSidebar({
  collapsed,
  permissions,
  userName,
  userEmail,
  onNavigate,
}: {
  collapsed: boolean;
  permissions: string[];
  userName: string;
  userEmail: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const visibleItems = adminNavigation.filter((item) => isNavItemVisible(item, permissions));
  const activeItem = resolveActiveNavItem(visibleItems, pathname);

  return (
    <div className="flex h-full flex-col">
      <div
        className={`flex h-16 shrink-0 items-center border-b border-slate-200 ${collapsed ? 'justify-center px-2' : 'px-4'}`}
      >
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <BrandMark compact={collapsed} />
        </Link>
      </div>

      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-2 py-4">
        <ul className="flex flex-col gap-1">
          {visibleItems.map((item) => {
            const active = item === activeItem;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 ${
                    collapsed ? 'justify-center' : ''
                  } ${
                    active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 shrink-0 ${active ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'}`}
                    aria-hidden="true"
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className={`mt-auto flex shrink-0 items-center gap-2 border-t border-slate-200 p-3 ${collapsed ? 'justify-center' : ''}`}
        title={collapsed ? `${userName} · ${userEmail}` : undefined}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
          {getInitials(userName)}
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{userName}</p>
            <p className="truncate text-xs text-slate-500">{userEmail}</p>
          </div>
        )}
      </div>
    </div>
  );
}
