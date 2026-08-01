'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { resolvePageTitle } from '../../lib/admin-navigation';
import { AdminSidebar } from './admin-sidebar';
import { AdminTopbar } from './admin-topbar';

const SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';

export function AdminShell({
  children,
  userName,
  userEmail,
  permissions,
}: {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  permissions: string[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Read the persisted preference only after mount so the server-rendered
  // (always expanded) markup matches the first client render — avoids a
  // hydration mismatch. The one-frame "flash" to collapsed is an accepted
  // tradeoff for a stable, non-blocking initial render.
  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === '1') {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setMobileOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  const title = resolvePageTitle(pathname, permissions);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside
        id="admin-sidebar-desktop"
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-slate-200 bg-white shadow-sm transition-[width] duration-200 ease-in-out lg:block ${
          collapsed ? 'w-[72px]' : 'w-[260px]'
        }`}
      >
        <AdminSidebar
          collapsed={collapsed}
          permissions={permissions}
          userName={userName}
          userEmail={userEmail}
        />
      </aside>

      <button
        type="button"
        aria-label="Cerrar menú"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => setMobileOpen(false)}
        className={`fixed inset-0 z-40 cursor-default bg-slate-900/40 transition-opacity duration-200 lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        id="admin-sidebar-mobile"
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-white shadow-xl transition-transform duration-200 ease-in-out lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <AdminSidebar
          collapsed={false}
          permissions={permissions}
          userName={userName}
          userEmail={userEmail}
          onNavigate={() => setMobileOpen(false)}
        />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <AdminTopbar
          title={title}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onOpenMobileMenu={() => setMobileOpen(true)}
          userName={userName}
          userEmail={userEmail}
          showNotificationBell={permissions.includes('conversations.read.assigned')}
        />
        <main className="flex flex-1 flex-col p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
