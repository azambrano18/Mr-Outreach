'use client';

import type { UserSummary } from '@outreach/shared-types';
import { ClickableTableRow, PrimaryItemLink } from '../../../components/ui/data-table';
import { parseUserStatus } from '../../../lib/user-status';

/**
 * Same validated-state approach used on the detail page
 * (executive-action-visibility.ts) — a status that isn't exactly
 * 'ACTIVE'/'INACTIVE' must render as an explicit "Estado desconocido",
 * never silently as "Inactivo".
 */
function StatusPill({ status }: { status: unknown }) {
  const parsed = parseUserStatus(status);
  const label = parsed === 'ACTIVE' ? 'Activo' : parsed === 'INACTIVE' ? 'Inactivo' : 'Estado desconocido';
  const toneClasses =
    parsed === 'ACTIVE'
      ? 'bg-emerald-100 text-emerald-700'
      : parsed === 'INACTIVE'
        ? 'bg-slate-200 text-slate-600'
        : 'bg-amber-100 text-amber-800';
  const dotClasses = parsed === 'ACTIVE' ? 'bg-emerald-500' : parsed === 'INACTIVE' ? 'bg-slate-500' : 'bg-amber-500';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClasses}`} />
      {label}
    </span>
  );
}

/**
 * §3 — kept to the columns needed to identify a user and its main state.
 * Fecha de creación, clientes asignados, etc. live in the detail page
 * (ExecutiveProfileSummary) rather than repeated here.
 */
export function ExecutiveRow({ executive }: { executive: UserSummary }) {
  const profileHref = `/dashboard/executives/${executive.id}`;

  return (
    <ClickableTableRow href={profileHref} ariaLabel={`Ver perfil de ${executive.name}`}>
      <td className="px-4 py-3">
        <PrimaryItemLink href={profileHref}>{executive.name}</PrimaryItemLink>
      </td>
      <td className="px-4 py-3 text-slate-600">{executive.email}</td>
      <td className="px-4 py-3 text-slate-600">{executive.roleName}</td>
      <td className="px-4 py-3">
        <StatusPill status={executive.status} />
      </td>
      <td className="px-4 py-3 font-mono text-xs text-slate-500">
        {executive.lastLoginAt ? new Date(executive.lastLoginAt).toLocaleString('es-CL') : 'Nunca'}
      </td>
    </ClickableTableRow>
  );
}
