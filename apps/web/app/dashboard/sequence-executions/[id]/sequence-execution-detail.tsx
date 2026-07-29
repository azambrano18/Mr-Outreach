'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { AssignedMailboxSummary } from '@outreach/shared-types';
import type { SequenceExecutionSummary } from '../../../../lib/sequence-execution-types';
import type { SequenceTemplateSummary } from '../../../../lib/sequence-template-types';

type SimulatableState = 'QUEUED' | 'ACCEPTED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REJECTED';

const SIMULATION_STATE_OPTIONS: { value: SimulatableState; label: string }[] = [
  { value: 'QUEUED', label: 'En cola' },
  { value: 'ACCEPTED', label: 'Aceptada' },
  { value: 'RUNNING', label: 'En ejecución' },
  { value: 'COMPLETED', label: 'Completada' },
  { value: 'FAILED', label: 'Fallida' },
  { value: 'REJECTED', label: 'Rechazada' },
];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  VALIDATING: 'Validando',
  SUBMITTING: 'Enviando al servidor',
  SUBMISSION_UNKNOWN: 'Verificando envío…',
  ACCEPTED: 'Aceptada',
  RUNNING: 'En ejecución',
  COMPLETED: 'Completada',
  FAILED: 'Fallida',
  REJECTED: 'Rechazada',
};

/** §2 — server-administered per-prospect lifecycle, shown in plain language; "Step" is never shown to the executive. */
const PROSPECT_STATE_LABELS: Record<string, string> = {
  STEP_01_PENDING: 'Envío 1 pendiente',
  STEP_01_PROCESSING: 'Envío 1 en proceso',
  STEP_01_SENT: 'Envío 1 enviado',
  STEP_02_PENDING: 'Envío 2 pendiente',
  STEP_02_PROCESSING: 'Envío 2 en proceso',
  STEP_02_SENT: 'Envío 2 enviado',
  STEP_03_PENDING: 'Envío 3 pendiente',
  STEP_03_PROCESSING: 'Envío 3 en proceso',
  STEP_03_SENT: 'Envío 3 enviado',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('es-CL') : '—';
}

export function SequenceExecutionDetail({
  initialExecution,
  canRefresh,
  refreshEndpoint,
  canUpdate = false,
  canDelete = false,
  mailboxes = [],
  templates = [],
  canSimulate = false,
}: {
  initialExecution: SequenceExecutionSummary;
  canRefresh: boolean;
  refreshEndpoint: string;
  /** Omitted (defaults to false/[]) by the read-only admin monitor; only the executive's own view ever passes these. */
  canUpdate?: boolean;
  canDelete?: boolean;
  mailboxes?: AssignedMailboxSummary[];
  templates?: SequenceTemplateSummary[];
  /** Dev-only — true only for admins, and only actually rendered once /api/dev/simulated/executions/config confirms the tool is enabled (SEQUENCE_MOTOR_MODE=simulated, non-production). */
  canSimulate?: boolean;
}) {
  const router = useRouter();
  const [execution, setExecution] = useState(initialExecution);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [simulationToolAvailable, setSimulationToolAvailable] = useState(false);
  const [simulatedState, setSimulatedState] = useState<SimulatableState>('COMPLETED');
  const [simulatedReason, setSimulatedReason] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  useEffect(() => {
    if (!canSimulate) return;
    let cancelled = false;
    fetch('/api/dev/simulated/executions/config')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled) setSimulationToolAvailable(Boolean(body?.enabled));
      })
      .catch(() => {
        if (!cancelled) setSimulationToolAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canSimulate]);

  async function applySimulatedState(): Promise<void> {
    if (!window.confirm('Esta acción modifica únicamente el estado simulado de la Gestión para fines de prueba.')) {
      return;
    }
    setSimulationError(null);
    setSimulating(true);
    try {
      const response = await fetch(`/api/dev/simulated/executions/${execution.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: simulatedState,
          ...(simulatedReason.trim() ? { errorMessage: simulatedReason.trim() } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSimulationError(body.error ?? 'No se pudo aplicar el estado simulado.');
        return;
      }
      setExecution(body);
      router.refresh();
    } catch {
      setSimulationError('No se pudo contactar la API.');
    } finally {
      setSimulating(false);
    }
  }

  const isDraft = execution.status === 'DRAFT';
  const isSubmissionInFlight = execution.status === 'SUBMITTING' || execution.status === 'SUBMISSION_UNKNOWN';

  const [editMailboxId, setEditMailboxId] = useState(execution.mailboxId);
  const [editTemplateId, setEditTemplateId] = useState(execution.templateId);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const templatesForMailbox = useMemo(
    () => templates.filter((t) => t.mailboxId === editMailboxId),
    [templates, editMailboxId],
  );

  async function refresh(): Promise<void> {
    setError(null);
    setRefreshing(true);
    try {
      const response = await fetch(refreshEndpoint, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo actualizar el estado.');
        return;
      }
      setExecution(body);
    } catch {
      setError('No se pudo contactar la API.');
    } finally {
      setRefreshing(false);
    }
  }

  async function saveDraftChanges(): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      const patch: Record<string, string> = {};
      if (editMailboxId !== execution.mailboxId) patch.mailboxId = editMailboxId;
      if (editTemplateId !== execution.templateId) patch.templateId = editTemplateId;
      const response = await fetch(`/api/sequence-executions/${execution.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo guardar la gestión.');
        return;
      }
      setExecution(body);
      router.refresh();
    } catch {
      setError('No se pudo contactar la API.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft(): Promise<void> {
    if (
      !window.confirm(
        'Esta Gestión todavía no ha sido enviada al servidor. Al eliminarla se perderán el archivo, el mapeo y la configuración realizada.',
      )
    ) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/sequence-executions/${execution.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'No se pudo eliminar la gestión.');
        return;
      }
      router.push('/dashboard/sequence-executions');
      router.refresh();
    } catch {
      setError('No se pudo contactar la API.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {execution.name ?? `Borrador creado el ${new Date(execution.createdAt).toLocaleDateString('es-CL')}`}
        </h1>
        <p className="text-sm text-slate-500">
          {execution.clientName ?? '—'} · {execution.mailboxEmail} · {execution.templateName} (v{execution.templateVersionNumber})
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado local</span>
          <p className="text-sm text-slate-800">{STATUS_LABELS[execution.status] ?? execution.status}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado del servidor</span>
          <p className="text-sm text-slate-800">{execution.serverStatus ?? '—'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Recibida por el servidor</span>
          <p className="text-sm text-slate-800">{formatDateTime(execution.receivedAt)}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estimación de inicio</span>
          <p className="text-sm text-slate-800">
            {execution.estimatedStartAt ? formatDateTime(execution.estimatedStartAt) : 'No informada por el servidor'}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Inicio real</span>
          <p className="text-sm text-slate-800">{formatDateTime(execution.startedAt)}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Prospectos</span>
          <p className="text-sm text-slate-800">{execution.prospectCount ?? '—'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Recibidos / aceptados / rechazados</span>
          <p className="text-sm text-slate-800">
            {execution.receivedProspects ?? '—'} / {execution.acceptedProspects ?? '—'} / {execution.rejectedProspects ?? '—'}
          </p>
        </div>
        {execution.initialProspectState && (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado inicial de los prospectos</span>
            <p className="text-sm text-slate-800">
              {PROSPECT_STATE_LABELS[execution.initialProspectState] ?? execution.initialProspectState}
            </p>
          </div>
        )}
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Envío actual</span>
          <p className="text-sm text-slate-800">{execution.currentStepNumber ?? '—'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Enviados / pendientes / fallidos</span>
          <p className="text-sm text-slate-800">
            {execution.sentCount ?? '—'} / {execution.pendingCount ?? '—'} / {execution.failedCount ?? '—'}
          </p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Última sincronización</span>
          <p className="text-sm text-slate-800">{formatDateTime(execution.lastSyncedAt)}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Último error</span>
          <p className="text-sm text-red-600">{execution.lastError ?? '—'}</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isSubmissionInFlight && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p>
            {execution.status === 'SUBMISSION_UNKNOWN'
              ? 'No se recibió confirmación del servidor a tiempo. Estamos verificando si la gestión fue aceptada — puedes reintentar sin riesgo de duplicarla.'
              : 'Enviando la gestión al servidor…'}
          </p>
        </div>
      )}

      {canRefresh && execution.serverExecutionId && (
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="self-start rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {refreshing ? 'Actualizando…' : 'Actualizar estado'}
        </button>
      )}

      {/* §12 — only while DRAFT: template and account (while still assigned) remain editable. There is no start date to edit — it no longer exists. */}
      {isDraft && canUpdate && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
          <h2 className="text-sm font-medium text-slate-700">Editar gestión (borrador)</h2>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Cuenta asignada
            <select
              value={editMailboxId}
              onChange={(event) => {
                setEditMailboxId(event.target.value);
                setEditTemplateId('');
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {mailboxes.map((mailbox) => (
                <option key={mailbox.id} value={mailbox.id}>
                  {mailbox.email}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Plantilla publicada
            <select
              value={editTemplateId}
              onChange={(event) => setEditTemplateId(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Selecciona una plantilla</option>
              {templatesForMailbox.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} (v{template.latestPublishedVersion?.versionNumber})
                </option>
              ))}
            </select>
          </label>
          {editTemplateId !== execution.templateId && (
            <p className="text-xs text-amber-700">
              Cambiar la plantilla eliminará el mapeo de columnas ya realizado; deberás volver a mapear el archivo.
            </p>
          )}
          <button
            type="button"
            onClick={saveDraftChanges}
            disabled={saving || !editTemplateId}
            className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}

      {isDraft && canDelete && (
        <button
          type="button"
          onClick={deleteDraft}
          disabled={deleting}
          className="self-start rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? 'Eliminando…' : 'Eliminar gestión'}
        </button>
      )}

      {/*
        Dev-only — deliberately styled and worded to never be confused with a real production
        action: dashed amber border, its own "Disponible solo en modo simulado" label, and a
        separate confirmation copy from every other button on this page. Never rendered unless
        the backend itself confirmed (via /api/dev/simulated/executions/config) that
        SEQUENCE_MOTOR_MODE=simulated and NODE_ENV!==production.
      */}
      {canSimulate && simulationToolAvailable && (
        <div className="flex flex-col gap-3 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-amber-900">Controles de simulación</h2>
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              Disponible solo en modo simulado
            </span>
          </div>
          <p className="text-xs text-amber-800">
            Fuerza el estado de esta Gestión sin contactar ningún motor real — solo para validar visualmente las
            pestañas de Gestiones mientras Railway no está conectado.
          </p>

          <label className="flex flex-col gap-1 text-sm text-amber-900">
            Estado a simular
            <select
              value={simulatedState}
              onChange={(event) => setSimulatedState(event.target.value as SimulatableState)}
              className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
            >
              {SIMULATION_STATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {(simulatedState === 'FAILED' || simulatedState === 'REJECTED') && (
            <label className="flex flex-col gap-1 text-sm text-amber-900">
              Motivo simulado (opcional)
              <input
                type="text"
                value={simulatedReason}
                onChange={(event) => setSimulatedReason(event.target.value)}
                placeholder={
                  simulatedState === 'FAILED'
                    ? 'Fallo simulado para validación visual'
                    : 'Cuenta no disponible o plantilla inválida (simulado)'
                }
                maxLength={500}
                className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
              />
            </label>
          )}

          {simulationError && <p className="text-sm text-red-700">{simulationError}</p>}

          <button
            type="button"
            onClick={applySimulatedState}
            disabled={simulating}
            className="self-start rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {simulating ? 'Aplicando…' : 'Aplicar estado simulado'}
          </button>
        </div>
      )}
    </div>
  );
}
