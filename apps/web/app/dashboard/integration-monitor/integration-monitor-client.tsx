'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IntegrationCommand, IntegrationEvent, IntegrationSummary } from '@outreach/shared-types';
import { JsonViewer } from '../../../components/integration/json-viewer';
import { StatusBadge, StatusTone } from '../../../components/integration/status-badge';
import { Modal } from '../../../components/ui/modal';
import type {
  DeleteSimulationConversationsPreview,
  EligibleMailboxSummary,
  SimulationBatchSummary,
} from '../../../lib/simulation-conversation-types';

type Tab = 'resumen' | 'comandos' | 'eventos' | 'conversaciones';

const COMMAND_STATUS_TONE: Record<IntegrationCommand['status'], StatusTone> = {
  REQUESTED: 'neutral',
  ACCEPTED: 'warning',
  PROCESSING: 'warning',
  COMPLETED: 'good',
  FAILED: 'error',
  CANCELLED: 'neutral',
  TIMEOUT: 'error',
};

const EVENT_STATUS_TONE: Record<IntegrationEvent['status'], StatusTone> = {
  RECEIVED: 'neutral',
  PROCESSED: 'good',
  FAILED: 'error',
};

export function IntegrationMonitorClient({
  canManage,
  canGenerateSimulationConversations = false,
  canDeleteSimulationConversations = false,
}: {
  canManage: boolean;
  canGenerateSimulationConversations?: boolean;
  canDeleteSimulationConversations?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('resumen');
  const [summary, setSummary] = useState<IntegrationSummary | null>(null);
  const [commands, setCommands] = useState<IntegrationCommand[]>([]);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [selectedCommand, setSelectedCommand] = useState<IntegrationCommand | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<IntegrationEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const canSeeSimulationConversations = canGenerateSimulationConversations || canDeleteSimulationConversations;
  const [activeBatch, setActiveBatch] = useState<SimulationBatchSummary | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [eligibleMailboxes, setEligibleMailboxes] = useState<EligibleMailboxSummary[]>([]);
  const [selectedMailboxId, setSelectedMailboxId] = useState('');
  const [mailboxesLoading, setMailboxesLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePreview, setDeletePreview] = useState<DeleteSimulationConversationsPreview | null>(null);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadActiveBatch = useCallback(async () => {
    if (!canSeeSimulationConversations) return;
    setBatchLoading(true);
    setBatchError(null);
    try {
      const response = await fetch('/api/admin/simulation-conversations/active-batch');
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setBatchError(body?.error ?? 'No se pudo consultar el lote de conversaciones de prueba.');
        return;
      }
      setActiveBatch(body);
    } finally {
      setBatchLoading(false);
    }
  }, [canSeeSimulationConversations]);

  useEffect(() => {
    if (tab === 'conversaciones') void loadActiveBatch();
  }, [tab, loadActiveBatch]);

  async function openGenerateModal(): Promise<void> {
    setGenerateError(null);
    setSelectedMailboxId('');
    setShowGenerateModal(true);
    setMailboxesLoading(true);
    try {
      const response = await fetch('/api/admin/simulation-conversations/eligible-mailboxes');
      const body = await response.json().catch(() => []);
      if (!response.ok) {
        setGenerateError(body?.error ?? 'No se pudieron cargar las cuentas disponibles.');
        return;
      }
      setEligibleMailboxes(body);
      if (body.length > 0) setSelectedMailboxId(body[0].id);
    } finally {
      setMailboxesLoading(false);
    }
  }

  async function confirmGenerate(): Promise<void> {
    if (!selectedMailboxId) return;
    setGenerateError(null);
    setGenerating(true);
    try {
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const response = await fetch('/api/admin/simulation-conversations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ mailboxId: selectedMailboxId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setGenerateError(body?.error ?? 'No se pudieron generar las conversaciones de prueba.');
        return;
      }
      setActiveBatch(body);
      setShowGenerateModal(false);
    } catch {
      setGenerateError('No se pudo contactar la API.');
    } finally {
      setGenerating(false);
    }
  }

  async function openDeleteModal(): Promise<void> {
    if (!activeBatch) return;
    setDeleteError(null);
    setShowDeleteModal(true);
    setDeletePreviewLoading(true);
    try {
      const response = await fetch(`/api/admin/simulation-conversations/${activeBatch.id}/delete-preview`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setDeleteError(body?.error ?? 'No se pudo calcular la vista previa de eliminación.');
        return;
      }
      setDeletePreview(body);
    } finally {
      setDeletePreviewLoading(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!activeBatch) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/simulation-conversations/${activeBatch.id}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDeleteError(body?.error ?? 'No se pudo eliminar el lote de conversaciones de prueba.');
        return;
      }
      setActiveBatch(null);
      setShowDeleteModal(false);
      setDeletePreview(null);
    } catch {
      setDeleteError('No se pudo contactar la API.');
    } finally {
      setDeleting(false);
    }
  }

  const loadSummary = useCallback(async () => {
    const response = await fetch('/api/integration/summary');
    if (response.ok) setSummary(await response.json());
  }, []);

  const loadCommands = useCallback(async () => {
    const response = await fetch('/api/integration/commands');
    if (response.ok) setCommands(await response.json());
  }, []);

  const loadEvents = useCallback(async () => {
    const response = await fetch('/api/integration/events');
    if (response.ok) setEvents(await response.json());
  }, []);

  useEffect(() => {
    void loadSummary();
    void loadCommands();
    void loadEvents();
  }, [loadSummary, loadCommands, loadEvents]);

  async function openCommand(commandId: string): Promise<void> {
    const response = await fetch(`/api/integration/commands/${commandId}`);
    if (response.ok) {
      const body = await response.json();
      setSelectedCommand(body.command);
      setSelectedEvents(body.events);
    }
  }

  async function advanceCommand(commandId: string, mode: 'ONE' | 'ALL'): Promise<void> {
    setError(null);
    setLoading(commandId);
    try {
      const response = await fetch(`/api/integration/commands/${commandId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo avanzar el comando.');
        return;
      }
      await Promise.all([loadCommands(), loadSummary(), openCommand(commandId)]);
    } finally {
      setLoading(null);
    }
  }

  async function reprocessEvent(eventId: string): Promise<void> {
    setLoading(eventId);
    try {
      await fetch(`/api/integration/events/${eventId}/reprocess`, { method: 'POST' });
      await loadEvents();
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Monitor de integración</h1>
      <p className="text-sm text-slate-500">
        Inspecciona el Outbox (comandos) y el Inbox (eventos) del motor simulado — no aplica a envíos reales.
      </p>

      <div className="flex gap-2 border-b border-slate-200">
        {(
          canSeeSimulationConversations
            ? (['resumen', 'comandos', 'eventos', 'conversaciones'] as Tab[])
            : (['resumen', 'comandos', 'eventos'] as Tab[])
        ).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`px-3 py-2 text-sm font-medium capitalize ${
              tab === value ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {tab === 'resumen' && summary && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Modo del motor</span>
            <p className="text-sm text-slate-800">{summary.mailEngineMode}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Total de comandos</span>
            <p className="text-sm text-slate-800">{summary.totalCommands}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Comandos por estado</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(summary.commandsByStatus).map(([status, count]) => (
                <StatusBadge key={status} label={`${status}: ${count}`} tone="neutral" />
              ))}
            </div>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Total de eventos</span>
            <p className="text-sm text-slate-800">{summary.totalEvents}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Eventos por estado</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(summary.eventsByStatus).map(([status, count]) => (
                <StatusBadge key={status} label={`${status}: ${count}`} tone="neutral" />
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'comandos' && (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Recurso</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Creado</th>
                  <th className="px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((command) => (
                  <tr key={command.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono">{command.commandType}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {command.aggregateType} / {command.aggregateId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge label={command.status} tone={COMMAND_STATUS_TONE[command.status]} />
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(command.createdAt).toLocaleString('es-CL')}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void openCommand(command.commandId)}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:border-brand-300 hover:text-brand-700"
                        >
                          Ver JSON
                        </button>
                        {canManage && !['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(command.status) && (
                          <button
                            type="button"
                            disabled={loading === command.commandId}
                            onClick={() => void advanceCommand(command.commandId, 'ALL')}
                            className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
                          >
                            {loading === command.commandId ? '…' : 'Avanzar'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {commands.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      Sin comandos todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedCommand && (
            <JsonViewer
              value={{ command: selectedCommand, events: selectedEvents }}
              fileName={`${selectedCommand.commandId}.json`}
            />
          )}
        </div>
      )}

      {tab === 'eventos' && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Recibido</th>
                {canManage && <th className="px-3 py-2">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-mono">{event.eventType}</td>
                  <td className="px-3 py-2 text-slate-500">{event.origin}</td>
                  <td className="px-3 py-2">
                    <StatusBadge label={event.status} tone={EVENT_STATUS_TONE[event.status]} />
                  </td>
                  <td className="px-3 py-2 text-slate-500">{new Date(event.receivedAt).toLocaleString('es-CL')}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={loading === event.eventId}
                        onClick={() => void reprocessEvent(event.eventId)}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:border-brand-300 hover:text-brand-700"
                      >
                        {loading === event.eventId ? '…' : 'Reprocesar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    Sin eventos todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'conversaciones' && canSeeSimulationConversations && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Conversaciones de prueba</h2>
            <p className="text-xs text-slate-500">
              Genera 4 conversaciones sintéticas (Interesado / No interesado / No contactar / Deriva) contra una
              cuenta de correo real de staging, para probar la clasificación real sin enviar correos ni afectar datos
              productivos. Disponible solo en desarrollo/staging/pruebas, en modo de simulación.
            </p>
          </div>

          {batchError && <p className="text-xs text-red-600">{batchError}</p>}
          {batchLoading && <p className="text-xs text-slate-500">Cargando…</p>}

          {!batchLoading && !activeBatch && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs text-slate-500">No hay ningún lote de conversaciones de prueba activo.</p>
              {canGenerateSimulationConversations && (
                <button
                  type="button"
                  onClick={() => void openGenerateModal()}
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
                >
                  Generar conversaciones de prueba
                </button>
              )}
            </div>
          )}

          {!batchLoading && activeBatch && (
            <div className="flex flex-col gap-3">
              <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                <p>
                  Cuenta: <span className="font-medium text-slate-800">{activeBatch.mailboxEmail}</span>
                </p>
                <p>
                  Generado por {activeBatch.createdByUserName} el{' '}
                  {new Date(activeBatch.createdAt).toLocaleString('es-CL')}
                </p>
              </div>
              <ul className="flex flex-col gap-1">
                {activeBatch.conversations.map((conversation) => (
                  <li key={conversation.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-xs">
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                        Simulación
                      </span>
                      <span className="font-medium text-slate-800">{conversation.label}</span>
                      <span className="text-slate-400">{conversation.contactEmail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/dashboard/mailboxes/mine"
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                >
                  Ir a Conversaciones
                </a>
                {canDeleteSimulationConversations && (
                  <button
                    type="button"
                    onClick={() => void openDeleteModal()}
                    className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
                  >
                    Eliminar conversaciones de prueba
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={showGenerateModal} onClose={() => (generating ? undefined : setShowGenerateModal(false))} title="Generar conversaciones de prueba">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Generar conversaciones de prueba</h3>
          <p className="text-xs text-slate-600">
            Selecciona la cuenta de correo real que se usará como contexto. No se enviará ningún mensaje por esta
            cuenta — solo se usa como referencia visual y relacional.
          </p>

          {mailboxesLoading && <p className="text-xs text-slate-500">Cargando cuentas…</p>}

          {!mailboxesLoading && eligibleMailboxes.length === 0 && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              Debes vincular una cuenta de correo de prueba antes de generar las conversaciones.
            </p>
          )}

          {!mailboxesLoading && eligibleMailboxes.length > 0 && (
            <div className="flex flex-col gap-2">
              {eligibleMailboxes.map((mailbox) => (
                <label
                  key={mailbox.id}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-2 text-xs ${
                    selectedMailboxId === mailbox.id ? 'border-brand-400 bg-brand-50' : 'border-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="mailbox"
                      checked={selectedMailboxId === mailbox.id}
                      onChange={() => setSelectedMailboxId(mailbox.id)}
                    />
                    <span className="font-medium text-slate-800">{mailbox.email}</span>
                  </span>
                  <span className="pl-5 text-slate-500">
                    Cliente: {mailbox.clientName ?? '—'} · Dominio: {mailbox.domainName ?? '—'} · Ejecutivo principal:{' '}
                    {mailbox.primaryExecutiveName ?? '—'} · Estado: {mailbox.status}
                  </span>
                </label>
              ))}
            </div>
          )}

          {generateError && <p className="text-xs text-red-600">{generateError}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowGenerateModal(false)}
              disabled={generating}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmGenerate()}
              disabled={generating || !selectedMailboxId}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {generating ? 'Generando…' : 'Confirmar generación'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showDeleteModal} onClose={() => (deleting ? undefined : setShowDeleteModal(false))} title="Eliminar conversaciones de prueba">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Eliminar conversaciones de prueba</h3>

          {deletePreviewLoading && <p className="text-xs text-slate-500">Calculando…</p>}

          {!deletePreviewLoading && deletePreview && (
            <>
              <p className="text-xs text-slate-600">
                Cuenta: {deletePreview.batch.mailboxEmail} · Generado el{' '}
                {new Date(deletePreview.batch.createdAt).toLocaleString('es-CL')}
              </p>
              <ul className="rounded-md bg-slate-50 p-3 text-xs text-slate-700">
                <li>{deletePreview.conversationCount} conversaciones</li>
                <li>{deletePreview.messageCount} mensajes</li>
                <li>{deletePreview.contactCount} contactos sintéticos</li>
                <li>{deletePreview.companyCount} empresa sintética</li>
                <li>{deletePreview.sequenceCount} secuencia QA</li>
              </ul>
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                Esta acción no se puede deshacer. La cuenta de correo real, los clientes y usuarios no se ven
                afectados.
              </p>
            </>
          )}

          {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleting}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={deleting || deletePreviewLoading}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Eliminando…' : 'Confirmar eliminación'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
