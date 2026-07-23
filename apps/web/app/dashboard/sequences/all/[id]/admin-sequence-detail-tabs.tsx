'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AdminSequenceDetail, ClientAssigneeSummary } from '@outreach/shared-types';
import { ConfirmButton } from '../../../../../components/ui/confirm-button';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  PAUSED: 'Pausada',
  ARCHIVED: 'Archivada',
};

const TABS = ['Resumen', 'Resultados', 'Historial de eventos', 'Contenido'] as const;
type Tab = (typeof TABS)[number];

export function AdminSequenceDetailTabs({
  detail,
  assignableExecutives,
  canReassign,
  canPause,
  canArchive,
  canCancel,
  canRemoveProspects,
}: {
  detail: AdminSequenceDetail;
  assignableExecutives: ClientAssigneeSummary[];
  canReassign: boolean;
  canPause: boolean;
  canArchive: boolean;
  canCancel: boolean;
  canRemoveProspects: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Resumen');
  const [newExecutiveId, setNewExecutiveId] = useState('');
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);

  async function callAction(path: string, init?: RequestInit): Promise<Response> {
    setActionError(null);
    const response = await fetch(path, init);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setActionError(body.error ?? 'No se pudo completar la acción.');
    }
    return response;
  }

  async function handlePause(): Promise<void> {
    await callAction(`/api/sequences/${detail.id}/${detail.status === 'PAUSED' ? 'resume' : 'pause'}`, {
      method: 'POST',
    });
    router.refresh();
  }

  async function handleArchive(): Promise<void> {
    await callAction(`/api/sequences/${detail.id}/${detail.status === 'ARCHIVED' ? 'restore' : 'archive'}`, {
      method: 'POST',
    });
    router.refresh();
  }

  async function handleCancelPendingSends(): Promise<void> {
    const response = await callAction(`/api/sequences/${detail.id}/cancel-pending-sends`, { method: 'POST' });
    if (response.ok) {
      const body = await response.json();
      setCancelledMessage(`Se cancelaron ${body.cancelledJobs} envío(s) pendiente(s).`);
    }
    router.refresh();
  }

  async function handleReassign(): Promise<void> {
    if (!newExecutiveId) return;
    await callAction(`/api/sequences/${detail.id}/reassign-executive`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executiveId: newExecutiveId, reason: reason || undefined }),
    });
    setNewExecutiveId('');
    setReason('');
    router.refresh();
  }

  async function handleRemoveContact(contactId: string): Promise<void> {
    await callAction(`/api/sequences/${detail.id}/contacts/${contactId}/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Retirado desde el panel de monitoreo administrativo.' }),
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canPause && detail.status !== 'ARCHIVED' && (
          <ConfirmButton
            label={detail.status === 'PAUSED' ? 'Reanudar' : 'Pausar'}
            confirmTitle={detail.status === 'PAUSED' ? 'Reanudar secuencia' : 'Pausar secuencia'}
            confirmMessage={
              detail.status === 'PAUSED'
                ? 'La secuencia volverá a estar activa para el ejecutivo responsable.'
                : 'La secuencia dejará de avanzar hasta que se reanude.'
            }
            confirmLabel={detail.status === 'PAUSED' ? 'Reanudar' : 'Pausar'}
            onConfirm={handlePause}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
          />
        )}
        {canArchive && (
          <ConfirmButton
            label={detail.status === 'ARCHIVED' ? 'Restaurar' : 'Archivar'}
            confirmTitle={detail.status === 'ARCHIVED' ? 'Restaurar secuencia' : 'Archivar secuencia'}
            confirmMessage={
              detail.status === 'ARCHIVED'
                ? 'La secuencia vuelve a quedar disponible como borrador.'
                : 'La secuencia se archivará. El historial y las respuestas se conservan.'
            }
            confirmLabel={detail.status === 'ARCHIVED' ? 'Restaurar' : 'Archivar'}
            onConfirm={handleArchive}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-red-300 hover:text-red-700"
          />
        )}
        {canCancel && (
          <ConfirmButton
            label="Cancelar envíos futuros"
            confirmTitle="Cancelar envíos futuros"
            confirmMessage="Se cancelará todo envío aún no realizado de esta secuencia. Los correos ya enviados y el historial no se modifican. Esto no archiva la secuencia."
            confirmLabel="Cancelar envíos"
            onConfirm={handleCancelPendingSends}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-amber-300 hover:text-amber-700"
          />
        )}
        {detail.clientId && (
          <Link
            href={`/dashboard/clients/${detail.clientId}/conversations?sequenceId=${detail.id}`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            Ver conversaciones
          </Link>
        )}
      </div>

      {actionError && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p>}
      {cancelledMessage && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{cancelledMessage}</p>
      )}

      <div className="flex gap-2 border-b border-slate-200 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 font-medium ${
              tab === t ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Resumen' && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm ring-1 ring-slate-900/5">
            <dt className="text-slate-500">Cliente</dt>
            <dd className="text-slate-800">{detail.clientName ?? '—'}</dd>
            <dt className="text-slate-500">Cuenta de correo</dt>
            <dd className="text-slate-800">{detail.mailboxEmail ?? '—'}</dd>
            <dt className="text-slate-500">Ejecutivo responsable</dt>
            <dd className="text-slate-800">{detail.executiveName}</dd>
            <dt className="text-slate-500">Creado por</dt>
            <dd className="text-slate-800">{detail.createdByName}</dd>
            <dt className="text-slate-500">Estado</dt>
            <dd className="text-slate-800">{STATUS_LABEL[detail.status] ?? detail.status}</dd>
            <dt className="text-slate-500">Zona horaria</dt>
            <dd className="text-slate-800">{detail.timezone}</dd>
            <dt className="text-slate-500">Fecha de gestión</dt>
            <dd className="text-slate-800">{detail.managementDate ?? '—'}</dd>
            <dt className="text-slate-500">Fecha de inicio efectiva</dt>
            <dd className="text-slate-800">
              {detail.effectiveStartAt ? new Date(detail.effectiveStartAt).toLocaleString('es-CL') : '—'}
            </dd>
            <dt className="text-slate-500">Creada</dt>
            <dd className="text-slate-800">{new Date(detail.createdAt).toLocaleString('es-CL')}</dd>
          </dl>

          {canReassign && (
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
              <h3 className="text-sm font-semibold text-slate-900">Reasignar ejecutivo responsable</h3>
              {assignableExecutives.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Este cliente no tiene otros ejecutivos asignados para reasignar la secuencia.
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                    Nuevo ejecutivo responsable
                    <select
                      value={newExecutiveId}
                      onChange={(event) => setNewExecutiveId(event.target.value)}
                      className="min-w-[220px] rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">Selecciona…</option>
                      {assignableExecutives
                        .filter((executive) => executive.id !== detail.executiveId)
                        .map((executive) => (
                          <option key={executive.id} value={executive.id}>
                            {executive.name} ({executive.email})
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                    Motivo (opcional)
                    <input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Reorganización de cartera"
                      className="min-w-[220px] rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <ConfirmButton
                    label="Reasignar"
                    confirmTitle="Reasignar ejecutivo responsable"
                    confirmMessage="La secuencia pasará a aparecer como propia en la cuenta del nuevo ejecutivo. Quien la creó no cambia."
                    confirmLabel="Reasignar"
                    disabled={!newExecutiveId}
                    onConfirm={handleReassign}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'Resultados' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Prospectos', value: detail.results.prospectCount },
            { label: 'Pendientes', value: detail.results.pendingCount },
            { label: 'Enviados 1', value: detail.results.sentStep1 },
            { label: 'Enviados 2', value: detail.results.sentStep2 },
            { label: 'Enviados 3', value: detail.results.sentStep3 },
            { label: 'Respuestas', value: detail.results.repliedCount },
            { label: 'Rebotes', value: detail.results.bouncedCount },
            { label: 'Detenidos', value: detail.results.stoppedCount },
            { label: 'Errores', value: detail.results.errorCount },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4 text-center shadow-sm ring-1 ring-slate-900/5"
            >
              <span className="text-2xl font-semibold text-slate-900">{stat.value}</span>
              <span className="text-xs text-slate-500">{stat.label}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'Historial de eventos' && (
        <ul className="flex flex-col gap-2">
          {detail.events.map((event, index) => (
            <li
              key={`${event.type}-${index}`}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-900/5"
            >
              <span className="text-slate-700">{event.description}</span>
              <span className="text-xs text-slate-500">{new Date(event.at).toLocaleString('es-CL')}</span>
            </li>
          ))}
          {detail.events.length === 0 && (
            <li className="rounded-md border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-900/5">
              Todavía no hay eventos registrados.
            </li>
          )}
        </ul>
      )}

      {tab === 'Contenido' && (
        <div className="flex flex-col gap-4">
          {detail.steps.map((step) => (
            <div key={step.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{step.name}</h3>
                <span className="text-[11px] text-slate-400">
                  {step.isSentSnapshot ? 'Contenido efectivamente enviado' : 'Borrador actual (aún no enviado)'}
                </span>
              </div>
              <p className="text-sm text-slate-800">
                <span className="font-medium">Asunto:</span> {step.subject}
              </p>
              <div
                className="rounded-md border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700"
                dangerouslySetInnerHTML={{ __html: step.htmlBody }}
              />
            </div>
          ))}
        </div>
      )}

      {canRemoveProspects && (
        <p className="text-xs text-slate-400">
          Para retirar prospectos o empresas específicas de esta secuencia, hazlo desde el detalle de contactos —
          esta acción queda registrada en auditoría.
        </p>
      )}
    </div>
  );
}
