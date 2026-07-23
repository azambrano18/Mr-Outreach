'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ClientAssigneeSummary, UserSummary } from '@outreach/shared-types';
import { ConfirmButton } from '../ui/confirm-button';

/**
 * PUT /clients/:id/assignees replaces the whole list in one call (no
 * separate add/remove endpoints) — this component reconstructs the full
 * {primaryUserId, secondaryUserIds} payload on every add/remove action.
 */
export function ClientAssigneesManager({
  clientId,
  assignees,
  activeExecutives,
}: {
  clientId: string;
  assignees: ClientAssigneeSummary[];
  activeExecutives: UserSummary[];
}) {
  const router = useRouter();
  const [selectedExecutiveId, setSelectedExecutiveId] = useState('');
  const [role, setRole] = useState<'PRIMARY' | 'SECONDARY'>('SECONDARY');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const currentPrimary = assignees.find((a) => a.role === 'PRIMARY');
  const currentSecondaries = assignees.filter((a) => a.role === 'SECONDARY');
  const assignedIds = new Set(assignees.map((a) => a.id));
  const unassignedExecutives = activeExecutives.filter((e) => !assignedIds.has(e.id));

  async function putAssignees(primaryUserId: string | null, secondaryUserIds: string[]): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${clientId}/assignees`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryUserId, secondaryUserIds }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'No se pudo actualizar la asignación.');
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign(): Promise<void> {
    if (!selectedExecutiveId) return;
    if (role === 'PRIMARY') {
      await putAssignees(selectedExecutiveId, currentSecondaries.map((a) => a.id));
    } else {
      await putAssignees(currentPrimary?.id ?? null, [...currentSecondaries.map((a) => a.id), selectedExecutiveId]);
    }
    setSelectedExecutiveId('');
  }

  async function handleRemove(executiveId: string): Promise<void> {
    const nextPrimary = currentPrimary?.id === executiveId ? null : (currentPrimary?.id ?? null);
    const nextSecondaries = currentSecondaries.filter((a) => a.id !== executiveId).map((a) => a.id);
    await putAssignees(nextPrimary, nextSecondaries);
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {assignees.map((assignee) => (
          <li
            key={assignee.id}
            className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-900/5"
          >
            <div>
              <span className="font-medium text-slate-800">{assignee.name}</span>{' '}
              <span className="text-xs text-slate-500">{assignee.email}</span>
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {assignee.role === 'PRIMARY' ? 'Principal' : 'Secundario'}
              </span>
            </div>
            <ConfirmButton
              label="Quitar"
              confirmTitle="Quitar ejecutivo del cliente"
              confirmMessage={`${assignee.name} dejará de ver este cliente en "Mis clientes". Esto no elimina su historial ni sus cuentas de correo asignadas.`}
              confirmLabel="Quitar"
              onConfirm={() => handleRemove(assignee.id)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-red-300 hover:text-red-700"
            />
          </li>
        ))}
        {assignees.length === 0 && (
          <li className="rounded-md border border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">
            Ningún ejecutivo asignado todavía.
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Ejecutivo
          <select
            value={selectedExecutiveId}
            onChange={(event) => setSelectedExecutiveId(event.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
          >
            <option value="">Selecciona…</option>
            {unassignedExecutives.map((executive) => (
              <option key={executive.id} value={executive.id}>
                {executive.name} ({executive.email})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Rol
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as 'PRIMARY' | 'SECONDARY')}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
          >
            <option value="SECONDARY">Secundario</option>
            <option value="PRIMARY">Principal</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void handleAssign()}
          disabled={loading || !selectedExecutiveId}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Asignando…' : 'Asignar'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-slate-400">
        Asignar un ejecutivo al cliente le permite verlo en &quot;Mis clientes&quot;, pero no le entrega acceso
        a ninguna cuenta de correo por sí solo — eso se asigna por separado en cada cuenta.
      </p>
    </div>
  );
}
