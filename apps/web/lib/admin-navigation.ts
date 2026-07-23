import {
  Activity,
  Braces,
  Building2,
  Mail,
  ScrollText,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Item is visible if the user holds ANY of these permissions. */
  permissions: string[];
  /**
   * Item is hidden if the user holds ANY of these, even if it also matches
   * `permissions` above — needed because the built-in Administrador role
   * holds every permission in the catalog (see permission-catalog.ts's
   * `ADMIN_PERMISSION_KEYS = PERMISSION_CATALOG.map(...)`), so a plain
   * "assigned-only" executive permission can never be used, by itself, to
   * hide an item from admins — they hold that permission too. Still a pure
   * permission check, never a role check.
   */
  excludePermissions?: string[];
  /**
   * Extra path prefixes that should also count as "active" for this item —
   * used when `href` is a redirect alias (see app/dashboard/mail-accounts
   * and app/dashboard/texts) so the sidebar still highlights correctly once
   * the browser lands on the real underlying route.
   */
  matchPrefixes?: string[];
};

/**
 * Single source of truth for the admin sidebar. "Textos" (the templates
 * module) is deliberately NOT a menu item — Fase 9 moved email body
 * authoring into each sequence step's editor instead of a standalone
 * section. The `templates` module/routes/API stay intact underneath
 * (reusable for step content later), just unlinked from the sidebar.
 *
 * "Firmas" is also deliberately NOT a menu item — signature administration
 * is centralized inside each mailbox's own configuration (gear icon →
 * "Firma" tab) instead of a standalone section. `/dashboard/signatures` and
 * every signatures endpoint/permission stay intact, just unlinked from the
 * sidebar (see app/dashboard/signatures).
 *
 * "Clientes" is the principal operative entry point (client-hierarchy
 * pivot) — placed first, per that pivot's explicit request. There is no
 * standalone "Centro de conversaciones"/"Bandeja de entrada" menu item —
 * conversations are reached exclusively from within a client's own profile
 * ("Todas las conversaciones del cliente",
 * `/dashboard/clients/[clientId]/conversations`), never a global
 * cross-client screen.
 *
 * "Cuentas de Correos" is executive-only now (admin-reorg follow-up spec,
 * section 1): admins configure mailboxes exclusively inside each client's
 * Cliente → Dominio → Cuenta hierarchy (`/dashboard/clients`) — there is no
 * standalone cross-client mailbox list anymore, so the item is gated only on
 * `mailboxes.read.assigned` and only ever forwards an executive to their own
 * assigned mailboxes (`/dashboard/mailboxes/mine`), never an admin-facing
 * global list.
 *
 * "Secuencias" is a single entry for both roles, same alias-redirect trick
 * as "Cuentas de Correos": `/dashboard/sequences` forwards an admin
 * (`sequences.read_all`) to the global monitoring panel
 * (`/dashboard/sequences/all`, spec §4) and an executive
 * (`sequences.manage.own`) to their own wizard + borradores/programadas/en
 * ejecución/historial (`/dashboard/sequences/mine`) — never a shared
 * `/dashboard/admin/*` prefix.
 */
export const adminNavigation: NavigationItem[] = [
  {
    label: 'Clientes',
    href: '/dashboard/clients',
    icon: Building2,
    permissions: ['clients.read.all'],
  },
  {
    label: 'Ejecutivos',
    href: '/dashboard/executives',
    icon: Users,
    permissions: ['users.read'],
  },
  {
    label: 'Cuentas de Correos',
    href: '/dashboard/mail-accounts',
    icon: Mail,
    permissions: ['mailboxes.read.assigned'],
    // The Administrador role holds every permission in the catalog,
    // including mailboxes.read.assigned — this exclusion is what actually
    // hides the item for admins (see NavigationItem.excludePermissions).
    excludePermissions: ['mailboxes.read.all'],
    matchPrefixes: ['/dashboard/mailboxes'],
  },
  {
    label: 'Secuencias',
    href: '/dashboard/sequences',
    icon: Workflow,
    permissions: ['sequences.manage.own', 'sequences.read_all'],
    matchPrefixes: ['/dashboard/sequences'],
  },
  {
    label: 'Variables',
    href: '/dashboard/variables',
    icon: Braces,
    permissions: ['variables.read'],
  },
  {
    label: 'Auditoría',
    href: '/dashboard/audit',
    icon: ScrollText,
    permissions: ['audit.read'],
  },
  {
    label: 'Monitor de integración',
    href: '/dashboard/integration-monitor',
    icon: Activity,
    permissions: ['integration_commands.read', 'integration_events.read'],
  },
];

export function isNavItemActive(item: NavigationItem, pathname: string): boolean {
  const prefixes = [item.href, ...(item.matchPrefixes ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Visible if the user holds any of `permissions` and none of `excludePermissions`. */
export function isNavItemVisible(item: NavigationItem, permissions: string[]): boolean {
  const hasAny = item.permissions.some((permission) => permissions.includes(permission));
  const hasExcluded = item.excludePermissions?.some((permission) => permissions.includes(permission)) ?? false;
  return hasAny && !hasExcluded;
}

/** Section title shown in the topbar, resolved from the active route. */
export function resolvePageTitle(pathname: string): string {
  if (pathname === '/dashboard') {
    return 'Inicio';
  }
  const match = adminNavigation.find((item) => isNavItemActive(item, pathname));
  return match?.label ?? 'Panel';
}
