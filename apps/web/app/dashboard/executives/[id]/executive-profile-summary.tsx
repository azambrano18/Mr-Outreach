'use client';

import type { UserSummary } from '@outreach/shared-types';
import { parseUserStatus } from '../../../../lib/user-status';

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'slate' | 'amber' }) {
  const toneClasses = {
    green: 'bg-emerald-100 text-emerald-700',
    slate: 'bg-slate-200 text-slate-600',
    amber: 'bg-amber-100 text-amber-800',
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses}`}>
      {label}
    </span>
  );
}

/**
 * Same runtime check `getExecutiveActionsVisibility` is built on — the
 * badge must never silently render "Inactivo" for a status it doesn't
 * actually recognize (that "anything not ACTIVE reads as inactive"
 * shortcut is exactly what let this page disagree with itself about
 * whether an executive was inactive; see executive-action-visibility.ts).
 */
function statusPillProps(rawStatus: unknown): { label: string; tone: 'green' | 'slate' | 'amber' } {
  const status = parseUserStatus(rawStatus);
  if (status === 'ACTIVE') return { label: 'Activo', tone: 'green' };
  if (status === 'INACTIVE') return { label: 'Inactivo', tone: 'slate' };
  return { label: 'Estado desconocido', tone: 'amber' };
}

/**
 * Spec §6.1/§6.3 — the Ejecutivos module is access administration only. No
 * operational tabs (clientes asignados/cuentas asignadas/secuencias/
 * actividad/permisos) — those already live in their own modules.
 */
export function ExecutiveProfileSummary({ executive }: { executive: UserSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Nombre</span>
        <p className="text-sm text-slate-800">{executive.firstName}</p>
      </div>
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Apellido</span>
        <p className="text-sm text-slate-800">{executive.lastName}</p>
      </div>
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Correo institucional
        </span>
        <p className="text-sm text-slate-800">{executive.email}</p>
      </div>
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Rol</span>
        <p className="text-sm text-slate-800">{executive.roleName}</p>
      </div>
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado</span>
        <p>
          <StatusPill {...statusPillProps(executive.status)} />
        </p>
      </div>
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Fecha de creación</span>
        <p className="text-sm text-slate-800">{new Date(executive.createdAt).toLocaleDateString('es-CL')}</p>
      </div>
      <div>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Último acceso</span>
        <p className="text-sm text-slate-800">
          {executive.lastLoginAt ? new Date(executive.lastLoginAt).toLocaleString('es-CL') : 'Nunca'}
        </p>
      </div>
    </div>
  );
}
