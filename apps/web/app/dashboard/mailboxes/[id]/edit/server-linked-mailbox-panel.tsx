'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AssigneeSummary, AuditLogEntry, MailboxSummary, UserSummary } from '@outreach/shared-types';
import { SecondaryExecutivesSelect } from './secondary-executives-select';

const LINK_SOURCE_LABEL: Record<MailboxSummary['linkSource'], string> = {
  SERVER_TOKEN: 'Vinculada por token',
  LEGACY_LOCAL: 'Cuenta heredada',
};

const ASSIGNMENT_ROLE_LABEL: Record<AssigneeSummary['role'], string> = {
  PRIMARY: 'Ejecutivo principal',
  SECONDARY: 'Ejecutivo secundario',
};

/**
 * Fase 2.1, §17 — the screen for a SERVER_TOKEN mailbox. Deliberately never
 * shows IMAP/SMTP host/port/user/password, "Probar conexión", "Provision"/
 * "Advance", or a signature editor for the admin — the signature now lives
 * inside each Plantilla's own editor instead (§10-11 of the account-
 * restructuring follow-up).
 *
 * §6 — sections always render in this fixed order: A. Información de la
 * cuenta, B. Asignaciones, C. Estado y sincronización, D. Conversaciones,
 * E. Auditoría, F. Zona de desvinculación (always last).
 */
export function ServerLinkedMailboxPanel({
  mailbox,
  executives,
  currentUserId,
  canReassign,
  canUnlink,
  canViewAudit,
  canViewConversations,
}: {
  mailbox: MailboxSummary;
  executives: UserSummary[];
  currentUserId: string;
  canReassign: boolean;
  canUnlink: boolean;
  canViewAudit: boolean;
  /** Holds `mailboxes.read.assigned` — the same permission that gates the Conversaciones module itself; final visibility still requires an actual assignment on THIS mailbox (checked from `assignees` below). */
  canViewConversations: boolean;
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

  async function handleSaveSecondaries(nextSelection: string[]): Promise<void> {
    setSelectedSecondaryIds(nextSelection);
    setSecondariesError(null);
    setSavingSecondaries(true);
    try {
      const currentPrimaryId = assignees?.find((a) => a.role === 'PRIMARY')?.id ?? null;
      const response = await fetch(`/api/mailboxes/${mailbox.id}/assignees`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryUserId: currentPrimaryId,
          secondaryUserIds: nextSelection,
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

  const myAssignment = assignees?.find((a) => a.id === currentUserId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* A. Información de la cuenta — solo lectura. */}
      <section className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
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
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado técnico</span>
          <p className="text-sm text-slate-800">{mailbox.serverStatusSnapshot ?? 'UNKNOWN'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Puede enviar</span>
          <p className="text-sm text-slate-800">
            {mailbox.serverCanSendSnapshot === null ? '—' : mailbox.serverCanSendSnapshot ? 'Sí' : 'No'}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Origen</span>
          <p className="text-sm text-slate-800">{LINK_SOURCE_LABEL[mailbox.linkSource]}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Identificadores externos</span>
          <p className="font-mono text-sm text-slate-800">{mailbox.serverMailboxId ?? '—'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Fecha de vinculación</span>
          <p className="text-sm text-slate-800">
            {mailbox.linkedAt ? new Date(mailbox.linkedAt).toLocaleString('es-CL') : '—'}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Última sincronización</span>
          <p className="text-sm text-slate-800">
            {mailbox.serverStatusCheckedAt ? new Date(mailbox.serverStatusCheckedAt).toLocaleString('es-CL') : 'Nunca'}
          </p>
        </div>
      </section>

      {/* B. Asignaciones. */}
      {canReassign && (
        <section className="flex flex-col gap-4 rounded-md border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700">Asignaciones</h2>

          <fieldset className="flex flex-col gap-2">
            <legend className="px-0 text-xs font-medium uppercase tracking-wide text-slate-500">Ejecutivo principal</legend>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={primaryExecutiveId}
                onChange={(event) => setPrimaryExecutiveId(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Selecciona un ejecutivo</option>
                {executives.map((executive) => (
                  <option key={executive.id} value={executive.id}>
                    {executive.name} · {executive.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleReassign}
                disabled={reassigning || !primaryExecutiveId}
                className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {reassigning ? 'Reasignando…' : 'Reasignar'}
              </button>
            </div>
            {reassignError && <p className="text-sm text-red-600">{reassignError}</p>}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="px-0 text-xs font-medium uppercase tracking-wide text-slate-500">Ejecutivos secundarios</legend>
            {assigneesError && <p className="text-sm text-red-600">{assigneesError}</p>}
            {assignees === null && !assigneesError ? (
              <p className="text-sm text-slate-500">Cargando ejecutivos…</p>
            ) : (
              <SecondaryExecutivesSelect
                candidates={executives.filter((executive) => executive.id !== assignees?.find((a) => a.role === 'PRIMARY')?.id)}
                selectedIds={selectedSecondaryIds}
                onChange={handleSaveSecondaries}
                disabled={assignees === null || savingSecondaries}
              />
            )}
            {savingSecondaries && <p className="text-xs text-slate-500">Guardando…</p>}
            {secondariesError && <p className="text-sm text-red-600">{secondariesError}</p>}
          </fieldset>
        </section>
      )}

      {/* C. Estado y sincronización. */}
      <section className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="text-sm font-medium text-slate-700">Estado y sincronización</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado local</span>
            <p className="text-sm text-slate-800">{mailbox.status === 'ACTIVE' ? 'Activa' : 'Inactiva'}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado del servidor</span>
            <p className="text-sm text-slate-800">{mailbox.serverStatusSnapshot ?? 'UNKNOWN'}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Última verificación</span>
            <p className="text-sm text-slate-800">
              {mailbox.serverStatusCheckedAt ? new Date(mailbox.serverStatusCheckedAt).toLocaleString('es-CL') : 'Nunca'}
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
          {refreshing ? 'Actualizando…' : 'Actualizar estado'}
        </button>
      </section>

      {/* D. Conversaciones — visible únicamente con asignación activa propia (revalidado por el backend, nunca solo aquí). */}
      {canViewConversations && (
        <section className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700">Conversaciones</h2>
          {myAssignment ? (
            <>
              <p className="text-sm text-slate-600">
                Rol de asignación actual: <span className="font-medium">{ASSIGNMENT_ROLE_LABEL[myAssignment.role]}</span>
              </p>
              <Link
                href={`/dashboard/conversations?mailboxId=${mailbox.id}`}
                className="self-start rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                Ver conversaciones
              </Link>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Debes estar asignado a esta cuenta para acceder a sus conversaciones.
            </p>
          )}
        </section>
      )}

      {/* E. Auditoría. */}
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

      {/* F. Zona de desvinculación — siempre al final. */}
      {canUnlink && mailbox.linkStatus !== 'REVOKED' && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-4">
          <legend className="px-1 text-sm font-medium text-red-800">Desvincular cuenta</legend>
          <p className="text-sm text-red-800">
            Esta acción revocará el uso de la cuenta dentro de Mr Outreach. La cuenta no será
            eliminada físicamente del servidor. Puede volver a vincularse más adelante con un nuevo
            token. Esta acción queda registrada en auditoría.
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
    </div>
  );
}
