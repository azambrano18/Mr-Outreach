'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AssignedMailboxSummary } from '@outreach/shared-types';
import type { SequenceExecutionSummary } from '../../../../lib/sequence-execution-types';
import type { SequenceTemplateSummary } from '../../../../lib/sequence-template-types';
import { ColumnMappingBoard, type MappingField } from './column-mapping-board';
import { StartExecutionConfirmationModal } from './start-execution-confirmation-modal';

interface MappingRowPreview {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: { email: string; contactName: string | null; companyName: string | null; variables: Record<string, string> } | null;
  status: 'VALID' | 'INVALID' | 'DUPLICATE';
  errors: string[];
}

interface MappingResult {
  importId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  missingRequiredVariables: string[];
  rows: MappingRowPreview[];
}

/** §5/§12 — no "Fecha de inicio" step: the executive never picks a start date/time anywhere in this flow. */
const WIZARD_STEPS = ['Cuenta y plantilla', 'Cargar archivo', 'Mapeo de columnas', 'Confirmación'];

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

export function NewSequenceExecutionWizard({
  mailboxes,
  templates,
}: {
  mailboxes: AssignedMailboxSummary[];
  templates: SequenceTemplateSummary[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [mailboxId, setMailboxId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const templatesForMailbox = useMemo(
    () => templates.filter((t) => t.mailboxId === mailboxId),
    [templates, mailboxId],
  );
  const visibleTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) return templatesForMailbox;
    return templatesForMailbox.filter((t) => t.name.toLowerCase().includes(query));
  }, [templatesForMailbox, templateSearch]);

  const [execution, setExecution] = useState<SequenceExecutionSummary | null>(null);
  const [creating, setCreating] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [requiredVariables, setRequiredVariables] = useState<string[]>([]);

  const [fieldAssignments, setFieldAssignments] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState<MappingResult | null>(null);
  const [mappingSaving, setMappingSaving] = useState(false);

  const customMappingFields: MappingField[] = useMemo(
    () =>
      requiredVariables
        .filter((key) => key !== 'contact_name' && key !== 'company_name')
        .map((key) => ({ key, label: `{${key}}`, required: true })),
    [requiredVariables],
  );

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<SequenceExecutionSummary | null>(null);

  async function createExecution(): Promise<void> {
    setError(null);
    setCreating(true);
    try {
      const response = await fetch('/api/sequence-executions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailboxId, templateId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo crear la gestión.');
        return;
      }
      setExecution(body as SequenceExecutionSummary);
      setStep(1);
    } catch {
      setError('No se pudo contactar la API.');
    } finally {
      setCreating(false);
    }
  }

  async function uploadFile(): Promise<void> {
    if (!file || !execution) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/sequence-executions/${execution.id}/import`, { method: 'POST', body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo subir el archivo.');
        return;
      }
      setHeaders(body.headers ?? []);
      setPreviewRows(body.previewRows ?? []);

      const requiredResponse = await fetch(`/api/sequence-executions/${execution.id}/import/required-variables`);
      const requiredBody = await requiredResponse.json().catch(() => ({ variables: [] }));
      setRequiredVariables(requiredBody.variables ?? []);
      setStep(2);
    } catch {
      setError('No se pudo contactar la API.');
    } finally {
      setUploading(false);
    }
  }

  async function submitMapping(): Promise<void> {
    if (!execution) return;
    setError(null);
    setMappingSaving(true);
    try {
      const customVariables = Object.fromEntries(
        customMappingFields.filter((field) => fieldAssignments[field.key]).map((field) => [field.key, fieldAssignments[field.key]]),
      );
      const response = await fetch(`/api/sequence-executions/${execution.id}/mapping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fieldAssignments.email ?? '',
          contactName: fieldAssignments.contact_name || undefined,
          companyName: fieldAssignments.company_name || undefined,
          customVariables,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo validar el mapeo.');
        return;
      }
      setMapping(body as MappingResult);
      setStep(3);
    } catch {
      setError('No se pudo contactar la API.');
    } finally {
      setMappingSaving(false);
    }
  }

  /** §4 — "Iniciar gestión" submits immediately; there is no date/time to pick, no "programar"/"agendar"/"publicar" step. */
  async function startExecution(): Promise<void> {
    if (!execution) return;
    setStartError(null);
    setStarting(true);
    try {
      const response = await fetch(`/api/sequence-executions/${execution.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStartError(body.error ?? 'No se pudo enviar la gestión al servidor. Puedes reintentar sin riesgo de duplicarla.');
        return;
      }
      setShowConfirmModal(false);
      setAccepted(body as SequenceExecutionSummary);
    } catch {
      setStartError('No se pudo contactar la API. Puedes reintentar sin riesgo de duplicar la gestión.');
    } finally {
      setStarting(false);
    }
  }

  function mappingSummaryText(): string {
    const parts = [`Correo → ${fieldAssignments.email ?? '—'}`];
    if (fieldAssignments.contact_name) parts.push(`Contacto → ${fieldAssignments.contact_name}`);
    if (fieldAssignments.company_name) parts.push(`Empresa → ${fieldAssignments.company_name}`);
    const customCount = customMappingFields.filter((f) => fieldAssignments[f.key]).length;
    if (customCount > 0) parts.push(`${customCount} variable(s) personalizada(s)`);
    return parts.join(' · ');
  }

  if (accepted) {
    const prospectStateLabel = accepted.initialProspectState
      ? PROSPECT_STATE_LABELS[accepted.initialProspectState] ?? accepted.initialProspectState
      : 'Envío 1 pendiente';
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-sm font-medium text-emerald-800">Gestión aceptada.</p>
        <p className="text-xs text-emerald-700">{accepted.name ?? 'Borrador de gestión'}</p>
        <p className="text-xs text-emerald-700">
          Prospectos en {prospectStateLabel.toLowerCase()} ({accepted.acceptedProspects ?? accepted.prospectCount ?? '—'})
        </p>
        <button
          type="button"
          onClick={() => {
            router.push(`/dashboard/sequence-executions/${execution!.id}`);
            router.refresh();
          }}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          Ver gestión
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 text-xs">
        {WIZARD_STEPS.map((label, index) => (
          <span
            key={label}
            className={`rounded-full px-3 py-1 font-medium ${
              index === step ? 'bg-brand-600 text-white' : index < step ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {index + 1}. {label}
          </span>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {step === 0 && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Cuenta asignada
            <select
              value={mailboxId}
              onChange={(event) => {
                setMailboxId(event.target.value);
                setTemplateId('');
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Selecciona una cuenta</option>
              {mailboxes.map((mailbox) => (
                <option key={mailbox.id} value={mailbox.id}>
                  {mailbox.email}
                </option>
              ))}
            </select>
          </label>

          {mailboxId && (
            <div className="flex flex-col gap-2 text-sm text-slate-700">
              <span>Plantilla publicada</span>
              {templatesForMailbox.length === 0 ? (
                <p className="text-xs text-amber-700">
                  No hay plantillas publicadas para esta cuenta. Publica una plantilla primero.
                </p>
              ) : (
                <>
                  <input
                    type="search"
                    value={templateSearch}
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    placeholder="Buscar plantilla por nombre…"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                  />
                  <div className="flex flex-col gap-2">
                    {visibleTemplates.length === 0 && (
                      <p className="text-xs text-slate-500">Ninguna plantilla coincide con la búsqueda.</p>
                    )}
                    {visibleTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setTemplateId(template.id)}
                        className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors ${
                          templateId === template.id
                            ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-sm font-medium text-slate-900">{template.name}</span>
                        <span className="text-xs text-slate-500">
                          Versión {template.latestPublishedVersion?.versionNumber} · {template.mailboxEmail} ·{' '}
                          {template.clientName ?? '—'}
                          {template.latestPublishedVersion?.acceptedAt &&
                            ` · Publicada el ${new Date(template.latestPublishedVersion.acceptedAt).toLocaleDateString('es-CL')}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={!mailboxId || !templateId || creating}
            onClick={createExecution}
            className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? 'Creando…' : 'Continuar'}
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Archivo de prospectos (.xlsx o .csv)
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={!file || uploading}
            onClick={uploadFile}
            className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {uploading ? 'Subiendo…' : 'Subir archivo'}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
          <p className="text-xs text-slate-500">{previewRows.length} filas de muestra de {headers.length} columnas detectadas.</p>

          <ColumnMappingBoard
            headers={headers}
            previewRows={previewRows}
            customFields={customMappingFields}
            assignments={fieldAssignments}
            onChange={setFieldAssignments}
          />

          <button
            type="button"
            disabled={!fieldAssignments.email || mappingSaving}
            onClick={submitMapping}
            className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {mappingSaving ? 'Validando…' : 'Validar mapeo'}
          </button>
        </div>
      )}

      {step === 3 && mapping && execution && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
          <p className="text-sm text-slate-700">
            {mapping.validRows} filas válidas · {mapping.invalidRows} inválidas · {mapping.duplicateRows} duplicadas de{' '}
            {mapping.totalRows} totales.
          </p>
          {mapping.missingRequiredVariables.length > 0 && (
            <p className="text-sm text-amber-700">
              Faltan por mapear: {mapping.missingRequiredVariables.map((v) => `{${v}}`).join(', ')}
            </p>
          )}
          <p className="text-xs text-slate-500">
            El servidor administra el procesamiento de la base a partir de la Plantilla seleccionada. Mr Outreach no
            calcula ni impone una fecha, hora u orden de procesamiento.
          </p>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1.5 text-left">Fila</th>
                  <th className="px-2 py-1.5 text-left">Email</th>
                  <th className="px-2 py-1.5 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mapping.rows.slice(0, 20).map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-2 py-1.5">{row.rowNumber}</td>
                    <td className="px-2 py-1.5">{row.normalized?.email ?? row.raw[fieldAssignments.email] ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={
                          row.status === 'VALID'
                            ? 'text-emerald-700'
                            : row.status === 'DUPLICATE'
                              ? 'text-amber-700'
                              : 'text-red-600'
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={mapping.validRows === 0 || mapping.missingRequiredVariables.length > 0}
            onClick={() => setShowConfirmModal(true)}
            className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            Iniciar gestión
          </button>
        </div>
      )}

      {showConfirmModal && mapping && execution && (
        <StartExecutionConfirmationModal
          execution={execution}
          validRows={mapping.validRows}
          invalidRows={mapping.invalidRows}
          duplicateRows={mapping.duplicateRows}
          mappingSummary={mappingSummaryText()}
          starting={starting}
          error={startError}
          onCancel={() => setShowConfirmModal(false)}
          onConfirm={startExecution}
        />
      )}
    </div>
  );
}
