'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { UserSummary } from '@outreach/shared-types';

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
  const router = useRouter();
  const profileHref = `/dashboard/executives/${executive.id}`;

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>): void {
    if (event.key === 'Enter') {
      router.push(profileHref);
    }
  }

  return (
    <tr
      onClick={() => router.push(profileHref)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="link"
      aria-label={`Ver perfil de ${executive.name}`}
      className="cursor-pointer border-b border-slate-100 outline-none transition-colors last:border-0 hover:bg-brand-50/50 focus-visible:bg-brand-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
    >
      <td className="px-4 py-3">
        <Link
          href={profileHref}
          onClick={(event) => event.stopPropagation()}
          className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
        >
          {executive.name}
        </Link>
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
    </tr>
  );
}
