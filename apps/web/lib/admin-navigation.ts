import {
  Activity,
  Braces,
  FileText,
  Mail,
  MessageSquare,
  ScrollText,
  Send,
  Users,
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
 * "Clientes" is deliberately NOT a menu item anymore (interfaz simplification
 * spec, §7/§14): cliente y dominio ya no se administran manualmente — solo
 * existen como proyección de solo lectura derivada de la cuenta de correo
 * vinculada por token, mostrada dentro del listado/detalle de cuentas. The
 * routes under `/dashboard/clients/[clientId]` stay (Sequences' admin detail
 * page links directly into `/dashboard/clients/:id/conversations`, and the
 * executive's own "Mis clientes" is still reachable by direct link), just
 * unlinked from the sidebar.
 *
 * "Cuentas de Correos" now has two variants in this list: the admin one
 * (below, `mailboxes.read.all`) points at the global token-linked listing
 * (`/dashboard/mailboxes`, §12.1) with its own "Vincular cuenta" entry
 * point; the executive one (`mailboxes.read.assigned`, excluded for admins)
 * still forwards to their own assigned mailboxes
 * (`/dashboard/mailboxes/mine`).
 *
 * "Secuencias" is deliberately NOT a menu item for either role — the old
 * Sequence/SequenceContact/ScheduledEmail wizard it fronted
 * (`/dashboard/sequences*`) was replaced by Plantillas + Gestiones.
 * `sequences.read_all`/`sequences.manage.own` and the underlying routes
 * stay intact (legacy, frozen) in case another still-active feature
 * (Conversaciones) depends on the tables underneath, but are never linked
 * from either sidebar and never gain new capabilities.
 *
 * "Capacidades operativas del administrador" — the admin role now also
 * holds every operational permission an executive has
 * (`sequence_templates.*_own`, `sequence_executions.*_own`, see
 * permission-catalog.ts). "Plantillas"/"Gestiones" below therefore become
 * visible to admins too, through the exact same permission check as an
 * executive — no admin-specific entry, no `excludePermissions`, no
 * `/dashboard/admin/*` variant. The admin's own "Monitor de gestiones"
 * (read-only, org-wide) stays a separate, additional item.
 */
export const adminNavigation: NavigationItem[] = [
  {
    label: 'Ejecutivos',
    href: '/dashboard/executives',
    icon: Users,
    permissions: ['users.read'],
  },
  {
    // Admin-operational-capabilities follow-up, §1/§4 — the admin operates
    // as an executive when it comes to conversations: this reuses the EXACT
    // same module the executive already has (AccountsWorkspace, /me/
    // conversations, ConversationsService.listForExecutive), scoped only by
    // the admin's own active MailboxAssignment — never all conversations of
    // the organization just because they're admin. `/dashboard/conversations`
    // is a pure redirect alias to the executive's own route (see
    // app/dashboard/conversations/page.tsx). Listed BEFORE both "Cuentas de
    // Correos" items below (`resolvePageTitle` takes the first array match,
    // without checking visibility) so the topbar title resolves to
    // "Conversaciones" while on `/dashboard/mailboxes/mine` — a prefix both
    // other items' own broader `/dashboard/mailboxes` matchPrefix would
    // otherwise also match.
    label: 'Conversaciones',
    href: '/dashboard/conversations',
    icon: MessageSquare,
    permissions: ['mailboxes.read.all'],
    matchPrefixes: ['/dashboard/mailboxes/mine'],
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
    // Fase 2.1 §12.1 — admin-only, cross-client listing with filters
    // (cliente/dominio/ejecutivo/estado/canSend/vinculada/sin principal).
    // Deliberately a SEPARATE item from "Cuentas de Correos" above (which
    // stays executive-only per the admin-reorg decision): the two never
    // share a permission, an href, or a matchPrefix.
    label: 'Cuentas de Correos',
    href: '/dashboard/mailboxes',
    icon: Mail,
    permissions: ['mailboxes.read.all'],
    matchPrefixes: ['/dashboard/mailboxes'],
  },
  {
    // Etapa "cuenta del ejecutivo" — Plantillas (contenido reutilizable de 3
    // steps) separado de Gestiones (ejecuciones concretas). "Capacidades
    // operativas del administrador" — ADMIN_PERMISSION_KEYS now includes
    // sequence_templates.read_own (see permission-catalog.ts), so this item
    // is visible to both the executive and the admin, each scoped to their
    // own Plantillas by ownerUserId.
    label: 'Plantillas',
    href: '/dashboard/sequence-templates',
    icon: FileText,
    permissions: ['sequence_templates.read_own'],
    matchPrefixes: ['/dashboard/sequence-templates'],
  },
  {
    label: 'Gestiones',
    href: '/dashboard/sequence-executions',
    icon: Send,
    permissions: ['sequence_executions.read_own'],
    matchPrefixes: ['/dashboard/sequence-executions'],
  },
  {
    // Admin-only, read-only monitor — §23. Separate href/permission from
    // "Gestiones" above so the two items are never conflated.
    label: 'Monitor de gestiones',
    href: '/dashboard/admin/sequence-executions',
    icon: Send,
    permissions: ['sequence_executions.monitor_all'],
    matchPrefixes: ['/dashboard/admin/sequence-executions'],
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
