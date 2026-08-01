'use client';

import type { UserSummary } from '@outreach/shared-types';
import { ClickableTableRow, PrimaryItemLink } from '../../../components/ui/data-table';

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-500'}`} />
      {active ? 'Activo' : 'Inactivo'}
    </span>
  );
}

export function ExecutiveRow({
  executive,
  assignedClientCount,
  showAssignedClients,
}: {
  executive: UserSummary;
  assignedClientCount?: number;
  showAssignedClients: boolean;
}) {
  const profileHref = `/dashboard/executives/${executive.id}`;

  return (
    <ClickableTableRow href={profileHref} ariaLabel={`Ver perfil de ${executive.name}`}>
      <td className="px-4 py-3">
        <PrimaryItemLink href={profileHref}>{executive.name}</PrimaryItemLink>
      </td>
      <td className="px-4 py-3 text-slate-600">{executive.email}</td>
      <td className="px-4 py-3 text-slate-600">{executive.roleName}</td>
      <td className="px-4 py-3">
        <StatusPill active={executive.status === 'ACTIVE'} />
      </td>
      {showAssignedClients && <td className="px-4 py-3 text-slate-600">{assignedClientCount ?? 0}</td>}
      <td className="px-4 py-3 font-mono text-xs text-slate-500">
        {new Date(executive.createdAt).toLocaleDateString('es-CL')}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-slate-500">
        {executive.lastLoginAt ? new Date(executive.lastLoginAt).toLocaleString('es-CL') : 'Nunca'}
      </td>
    </ClickableTableRow>
  );
}
