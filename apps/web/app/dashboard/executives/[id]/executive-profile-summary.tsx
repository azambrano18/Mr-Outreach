'use client';

import type { UserSummary } from '@outreach/shared-types';

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'slate' }) {
  const toneClasses = {
    green: 'bg-emerald-100 text-emerald-700',
    slate: 'bg-slate-200 text-slate-600',
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses}`}>
      {label}
    </span>
  );
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
          <StatusPill
            label={executive.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
            tone={executive.status === 'ACTIVE' ? 'green' : 'slate'}
          />
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
