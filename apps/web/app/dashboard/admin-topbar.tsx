'use client';

import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NotificationBell } from '../../components/notifications/notification-bell';
import { UserMenu } from './user-menu';

export function AdminTopbar({
  title,
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onOpenMobileMenu,
  userName,
  userEmail,
  showNotificationBell,
}: {
  title: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onOpenMobileMenu: () => void;
  userName: string;
  userEmail: string;
  /** §4 — only executives (holders of `conversations.read.assigned`) get the bell; admins keep using Centro de conversaciones directly. */
  showNotificationBell: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
        aria-expanded={!collapsed}
        aria-controls="admin-sidebar-desktop"
        className="hidden rounded-md p-2 text-slate-500 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-400 lg:inline-flex"
      >
        {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </button>

      <button
        type="button"
        onClick={onOpenMobileMenu}
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
        aria-controls="admin-sidebar-mobile"
        className="inline-flex rounded-md p-2 text-slate-500 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-400 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <p className="flex-1 truncate text-sm font-semibold text-slate-900 sm:text-base">{title}</p>

      {showNotificationBell && <NotificationBell />}
      <UserMenu userName={userName} userEmail={userEmail} />
    </header>
  );
}
