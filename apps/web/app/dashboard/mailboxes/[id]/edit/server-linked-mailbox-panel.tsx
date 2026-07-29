'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AssigneeSummary, AuditLogEntry, MailboxSummary, UserSummary } from '@outreach/shared-types';

/**
 * Fase 2.1, §17 — the screen for a SERVER_TOKEN mailbox. Deliberately never
 * shows IMAP/SMTP host/port/user/password, "Probar conexión", "Provision"/
 * "Advance", or a signature editor for the admin — all of that belongs
 * only to the legacy IMAP/SMTP screen (edit-mailbox-form.tsx), never here.
 */
export function ServerLinkedMailboxPanel({
  mailbox,
  executives,
  canReassign,
  canUnlink,
  canViewAudit,
}: {
  mailbox: MailboxSummary;
  executives: UserSummary[];
  canReassign: boolean;
  canUnlink: boolean;
  canViewAudit: boolean;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [primaryExecutiveId, setPrimaryExecutiveId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignIdempotencyKey] = useState(() => crypto.randomUUID());

  const [unlinkReason, setUnlinkReason] = useState('');
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);

  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewAudit) return;
    let cancelled = false;
    async function loadAudit(): Promise<void> {
      try {
        const response = await fetch(`/api/mailboxes/${mailbox.id}/audit-log`);
        const body = await response.json().catch(() => []);
        if (cancelled) return;
        if (!response.ok) {
          setAuditError(body.error ?? 'No se pudo cargar la auditoría.');
          return;
        }
        setAuditEntries(body as AuditLogEntry[]);
      } catch {
        if (!cancelled) setAuditError('No se pudo contactar la API.');
      }
    }
    void loadAudit();
    return () => {
      cancelled = true;
    };
  }, [mailbox.id, canViewAudit]);

  const [assignees, setAssignees] = useState<AssigneeSummary[] | null>(null);
  const [assigneesError, setAssigneesError] = useState<string | null>(null);
  const [selectedSecondaryIds, setSelectedSecondaryIds] = useState<string[]>([]);
  const [savingSecondaries, setSavingSecondaries] = useState(false);
  const [secondariesError, setSecondariesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAssignees(): Promise<void> {
      try {
        const response = await fetch(`/api/mailboxes/${mailbox.id}/assignees`);
        const body = await response.json().catch(() => []);
        if (cancelled) return;
        if (!response.ok) {
          setAssigneesError(body.error ?? 'No se pudieron cargar los ejecutivos asignados.');
          return;
        }
        const loaded = body as AssigneeSummary[];
        setAssignees(loaded);
        setSelectedSecondaryIds(loaded.filter((a) => a.role === 'SECONDARY').map((a) => a.id));
      } catch {
        if (!cancelled) setAssigneesError('No se pudo contactar la API.');
      }
    }
    void loadAssignees();
    return () => {
      cancelled = true;
    };
  }, [mailbox.id]);

  function toggleSecondary(executiveId: string): void {
    setSelectedSecondaryIds((current) =>
      current.includes(executiveId) ? current.filter((id) => id !== executiveId) : [...current, executiveId],
    );
  }

  async function handleSaveSecondaries(): Promise<void> {
    setSecondariesError(null);
    setSavingSecondaries(true);
    try {
      const currentPrimaryId = assignees?.find((a) => a.role === 'PRIMARY')?.id ?? null;
      const response = await fetch(`/api/mailboxes/${mailbox.id}/assignees`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryUserId: currentPrimaryId,
          secondaryUserIds: selectedSecondaryIds,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSecondariesError(body.error ?? 'No se pudieron actualizar los ejecutivos secundarios.');
        return;
      }
      const updated = body as AssigneeSummary[];
      setAssignees(updated);
      setSelectedSecondaryIds(updated.filter((a) => a.role === 'SECONDARY').map((a) => a.id));
      router.refresh();
    } catch {
      setSecondariesError('No se pudo contactar la API.');
    } finally {
      setSavingSecondaries(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshError(null);
    setRefreshing(true);
    try {
      const response = await fetch(`/api/mailboxes/${mailbox.id}/refresh-status`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRefreshError(body.error ?? 'No se pudo refrescar el estado.');
        return;
      }
      router.refresh();
    } catch {
      setRefreshError('No se pudo contactar la API.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleReassign(): Promise<void> {
    if (!primaryExecutiveId) return;
    setReassignError(null);
    setReassigning(true);
    try {
      const response = await fetch(`/api/mailboxes/${mailbox.id}/primary-executive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': reassignIdempotencyKey },
        body: JSON.stringify({ newPrimaryExecutiveId: primaryExecutiveId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setReassignError(body.error ?? 'No se pudo reasignar el ejecutivo.');
        return;
      }
      router.refresh();
    } catch {
      setReassignError('No se pudo contactar la API.');
    } finally {
      setReassigning(false);
    }
  }

  async function handleUnlink(): Promise<void> {
    if (!unlinkReason.trim()) return;
    setUnlinkError(null);
    setUnlinking(true);
    try {
      const response = await fetch(`/api/mailboxes/${mailbox.id}/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ reason: unlinkReason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setUnlinkError(body.error ?? 'No se pudo desvincular la cuenta.');
        return;
      }
      setConfirmingUnlink(false);
      router.refresh();
    } catch {
      setUnlinkError('No se pudo contactar la API.');
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Cliente</span>
          <p className="text-sm text-slate-800">{mailbox.clientName ?? '— Sin clasificar —'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Dominio</span>
          <p className="text-sm text-slate-800">{mailbox.domainName ?? '—'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Correo</span>
          <p className="text-sm text-slate-800">{mailbox.email}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Nombre visible</span>
          <p className="text-sm text-slate-800">{mailbox.fromName}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado del vínculo</span>
          <p className="text-sm text-slate-800">{mailbox.linkStatus}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado técnico del servidor</span>
          <p className="text-sm text-slate-800">{mailbox.serverStatusSnapshot ?? 'UNKNOWN'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Última verificación</span>
          <p className="text-sm text-slate-800">
            {mailbox.serverStatusCheckedAt ? new Date(mailbox.serverStatusCheckedAt).toLocaleString('es-CL') : 'Nunca'}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Vinculada el</span>
          <p className="text-sm text-slate-800">
            {mailbox.linkedAt ? new Date(mailbox.linkedAt).toLocaleString('es-CL') : '—'}
          </p>
        </div>
      </div>

      {refreshError && <p className="text-sm text-red-600">{refreshError}</p>}
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        className="self-start rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
      >
        {refreshing ? 'Actualizando…' : 'Refrescar estado'}
      </button>

      {canReassign && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Reasignar ejecutivo principal</legend>
          <select
            value={primaryExecutiveId}
            onChange={(event) => setPrimaryExecutiveId(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Selecciona un ejecutivo</option>
            {executives.map((executive) => (
              <option key={executive.id} value={executive.id}>
                {executive.name}
              </option>
            ))}
          </select>
          {reassignError && <p className="text-sm text-red-600">{reassignError}</p>}
          <button
            type="button"
            onClick={handleReassign}
            disabled={reassigning || !primaryExecutiveId}
            className="self-start rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {reassigning ? 'Reasignando…' : 'Reasignar'}
          </button>
        </fieldset>
      )}

      {canReassign && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Ejecutivos secundarios</legend>
          {assigneesError && <p className="text-sm text-red-600">{assigneesError}</p>}
          {assignees === null && !assigneesError ? (
            <p className="text-sm text-slate-500">Cargando ejecutivos…</p>
          ) : (
            <div className="flex flex-col gap-1">
              {executives
                .filter((executive) => executive.id !== assignees?.find((a) => a.role === 'PRIMARY')?.id)
                .map((executive) => (
                  <label key={executive.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedSecondaryIds.includes(executive.id)}
                      onChange={() => toggleSecondary(executive.id)}
                    />
                    {executive.name}
                  </label>
                ))}
            </div>
          )}
          {secondariesError && <p className="text-sm text-red-600">{secondariesError}</p>}
          <button
            type="button"
            onClick={handleSaveSecondaries}
            disabled={savingSecondaries || assignees === null}
            className="self-start rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {savingSecondaries ? 'Guardando…' : 'Guardar secundarios'}
          </button>
        </fieldset>
      )}

      {canUnlink && mailbox.linkStatus !== 'REVOKED' && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-4">
          <legend className="px-1 text-sm font-medium text-red-800">Desvincular cuenta</legend>
          <p className="text-sm text-red-800">
            Esta acción bloqueará el uso operativo de la cuenta dentro de Mr Outreach: dejará de aparecer
            disponible para enviar o recibir. <strong>No se elimina físicamente en el servidor motor</strong> —
            la cuenta sigue existiendo ahí y puede volver a vincularse más adelante con un nuevo token. Esta
            acción queda registrada en auditoría.
          </p>
          {!confirmingUnlink ? (
            <button
              type="button"
              onClick={() => setConfirmingUnlink(true)}
              className="self-start rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
            >
              Desvincular cuenta
            </button>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="unlink-reason">
                Motivo (obligatorio)
                <input
                  id="unlink-reason"
                  required
                  value={unlinkReason}
                  onChange={(event) => setUnlinkReason(event.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              {unlinkError && <p className="text-sm text-red-600">{unlinkError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleUnlink}
                  disabled={unlinking || !unlinkReason.trim()}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {unlinking ? 'Desvinculando…' : 'Confirmar desvinculación'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingUnlink(false)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </fieldset>
      )}

      {canViewAudit && (
        <section className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700">Auditoría</h2>
          {auditError && <p className="text-sm text-red-600">{auditError}</p>}
          {auditEntries === null && !auditError ? (
            <p className="text-sm text-slate-500">Cargando auditoría…</p>
          ) : auditEntries && auditEntries.length === 0 ? (
            <p className="text-sm text-slate-500">Sin eventos registrados todavía.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {auditEntries?.map((entry) => (
                <li key={entry.id} className="text-sm text-slate-700">
                  <span className="font-medium">{entry.action}</span>
                  {' — '}
                  {new Date(entry.createdAt).toLocaleString('es-CL')}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
