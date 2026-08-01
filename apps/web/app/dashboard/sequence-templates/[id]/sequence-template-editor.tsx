'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { DEFAULT_TEMPLATE_VARIABLES, extractTemplateVariables } from '@outreach/validation';
import { RichTextEditor } from '../../../../components/rich-text-editor/rich-text-editor';
import { VariableInsertMenu } from '../../../../components/rich-text-editor/variable-insert-menu';
import { sanitizeRichTextHtml } from '../../../../lib/sanitize-html-client';
import type { SequenceTemplateDetail, SequenceTemplateStepSummary } from '../../../../lib/sequence-template-types';
import { EditPublishedTemplateModal } from './edit-published-template-modal';
import { PublishConfirmationModal } from './publish-confirmation-modal';
import { UpdateTemplateConfirmationModal, type TemplateUpdateImpact } from './update-template-confirmation-modal';

const MIN_DELAY_DAYS = 1;
const MAX_DELAY_DAYS = 20;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  PUBLISHING: 'Publicando…',
  PUBLISHED: 'Publicada',
  PUBLISH_FAILED: 'Publicación fallida',
  ARCHIVED: 'Archivada',
};

const AUTOSAVE_DELAY_MS = 900;

function exampleValueFor(key: string): string {
  if (key === 'email') return 'persona@empresa.cl';
  if (key === 'contact_name') return 'María';
  if (key === 'company_name') return 'Empresa Uno';
  return '[valor de ejemplo]';
}

function substitute(text: string, variables: { key: string }[]): string {
  let result = text;
  for (const variable of variables) {
    result = result.split(`{${variable.key}}`).join(exampleValueFor(variable.key));
  }
  return result;
}

function buildPreviewDocument(headerText: string, bodyHtml: string, signatureHtml: string, variables: { key: string }[]): string {
  const header = headerText.trim() ? sanitizeRichTextHtml(`<p>${substitute(headerText, variables)}</p>`) : '';
  const body = sanitizeRichTextHtml(substitute(bodyHtml, variables));
  const signature = signatureHtml.trim() ? sanitizeRichTextHtml(signatureHtml) : '';
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1e293b; background: #ffffff; }
    img { max-width: 100%; height: auto; }
  </style></head><body>
    ${header ? `<div style="padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid #e2e8f0;">${header}</div>` : ''}
    <div>${body}</div>
    ${signature ? `<div style="padding-top:16px;margin-top:24px;border-top:1px solid #e2e8f0;">${signature}</div>` : ''}
  </body></html>`;
}

/** §1-4 — no `allowedWeekdays`/`sendWindowStart`/`sendWindowEnd`/`delayUnit`: the schedule is fixed and never editable here (§2, Fase 1.7 — the wait is always business days). */
type EnvioDraft = Pick<SequenceTemplateStepSummary, 'headerText' | 'bodyHtml' | 'delayValue'>;

function draftFromStep(step: SequenceTemplateStepSummary): EnvioDraft {
  return {
    headerText: step.headerText,
    bodyHtml: step.bodyHtml,
    delayValue: step.delayValue,
  };
}

export function SequenceTemplateEditor({
  initialTemplate,
  canUpdate,
  canPublish,
  canArchive,
}: {
  initialTemplate: SequenceTemplateDetail;
  canUpdate: boolean;
  canPublish: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState(initialTemplate);

  const [subjectTemplate, setSubjectTemplate] = useState(template.subjectTemplate);
  const [signatureHtml, setSignatureHtml] = useState(template.signatureHtml);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const generalSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signatureSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signatureImageInputRef = useRef<HTMLInputElement | null>(null);

  const [activeEnvio, setActiveEnvio] = useState<1 | 2 | 3>(1);
  const [drafts, setDrafts] = useState<Record<1 | 2 | 3, EnvioDraft>>(() => {
    const map = {} as Record<1 | 2 | 3, EnvioDraft>;
    for (const step of template.steps) map[step.stepNumber] = draftFromStep(step);
    return map;
  });
  const envioSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout> | null>>({});
  const [tab, setTab] = useState<'editor' | 'preview'>('editor');

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validating, setValidating] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [archiving, setArchiving] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletability, setDeletability] = useState<{ canDelete: boolean; activeExecutionsCount: number } | null>(null);

  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateImpact, setUpdateImpact] = useState<TemplateUpdateImpact | null>(null);
  const [updateImpactLoading, setUpdateImpactLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  /** §11-13 — a PUBLISHED template's fields stay locked until the executive explicitly confirms "Editar plantilla publicada"; re-locks again once that new version is published. */
  const [editingUnlocked, setEditingUnlocked] = useState(false);
  const [showEditGateModal, setShowEditGateModal] = useState(false);
  const [editGateLoading, setEditGateLoading] = useState(false);
  const [editGateActiveExecutions, setEditGateActiveExecutions] = useState<number | null>(null);

  const isArchived = template.status === 'ARCHIVED';
  const isPublished = template.status === 'PUBLISHED';
  const isLocked = isArchived || (isPublished && !editingUnlocked);
  const currentDraft = drafts[activeEnvio];

  // Consolidación contractual — derived from the full version history, never
  // "latestPublishedVersion + 1": if a previous update attempt FAILED,
  // latestPublishedVersion still correctly points at the last ACCEPTED
  // version, so a naive "+1" would understate the real next version number.
  const nextDraftVersionNumber = template.versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

  useEffect(() => {
    if (template.status !== 'PUBLISHED') {
      setDeletability(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/sequence-templates/${template.id}/deletability`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setDeletability(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [template.id, template.status]);

  const customVariables = useMemo(() => {
    const all = [
      ...extractTemplateVariables(subjectTemplate),
      ...Object.values(drafts).flatMap((draft) => [
        ...extractTemplateVariables(draft.headerText ?? ''),
        ...extractTemplateVariables(draft.bodyHtml),
      ]),
    ];
    const standard = new Set(DEFAULT_TEMPLATE_VARIABLES.map((v) => v.key));
    return [...new Set(all)].filter((key) => !standard.has(key));
  }, [subjectTemplate, drafts]);

  const variablesForEditor = useMemo(
    () => [...DEFAULT_TEMPLATE_VARIABLES, ...customVariables.map((key) => ({ key, label: key }))],
    [customVariables],
  );

  // §8 — no visible "Guardar" affordance anywhere: edits persist silently, debounced, in the background.
  function scheduleGeneralSave(next: { subjectTemplate?: string }): void {
    if (generalSaveTimer.current) clearTimeout(generalSaveTimer.current);
    generalSaveTimer.current = setTimeout(async () => {
      const response = await fetch(`/api/sequence-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (response.ok) {
        const body = await response.json();
        setTemplate(body);
      }
    }, AUTOSAVE_DELAY_MS);
  }

  function scheduleEnvioSave(stepNumber: 1 | 2 | 3, next: EnvioDraft): void {
    const existingTimer = envioSaveTimers.current[stepNumber];
    if (existingTimer) clearTimeout(existingTimer);
    envioSaveTimers.current[stepNumber] = setTimeout(async () => {
      const response = await fetch(`/api/sequence-templates/${template.id}/steps/${stepNumber}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headerText: next.headerText,
          bodyHtml: next.bodyHtml,
          delayValue: next.delayValue,
        }),
      });
      if (response.ok) {
        const body = (await response.json()) as SequenceTemplateDetail;
        setTemplate(body);
      }
    }, AUTOSAVE_DELAY_MS);
  }

  // §11 (Fase Firma) — the signature is now the template's own draft field,
  // saved the exact same debounced way as the subject: no visible "Guardar"
  // button, editing it never touches an already-published version.
  function scheduleSignatureSave(next: string): void {
    if (signatureSaveTimer.current) clearTimeout(signatureSaveTimer.current);
    signatureSaveTimer.current = setTimeout(async () => {
      const response = await fetch(`/api/sequence-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureHtml: next }),
      });
      if (response.ok) {
        const body = await response.json();
        setTemplate(body);
      }
    }, AUTOSAVE_DELAY_MS);
  }

  useEffect(() => {
    return () => {
      if (generalSaveTimer.current) clearTimeout(generalSaveTimer.current);
      if (signatureSaveTimer.current) clearTimeout(signatureSaveTimer.current);
      Object.values(envioSaveTimers.current).forEach((t) => t && clearTimeout(t));
    };
  }, []);

  function updateSubject(value: string): void {
    setSubjectTemplate(value);
    scheduleGeneralSave({ subjectTemplate: value });
  }
  function updateSignature(value: string): void {
    setSignatureHtml(value);
    scheduleSignatureSave(value);
  }

  /** Fase Firma, §8 — uploads through the dedicated /signature-assets endpoint (never a pasted external URL), then inserts a fixed, safe <img> into the current draft. */
  async function handleSignatureImageSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImageUploadError(null);
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch('/api/signature-assets', { method: 'POST', body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setImageUploadError(body.error ?? 'No se pudo subir la imagen.');
        return;
      }
      const imgHtml = `<img src="${body.publicUrl}" alt="Logo" width="240" style="display:block;max-width:100%;height:auto;border:0;">`;
      updateSignature(`${signatureHtml}${imgHtml}`);
    } catch {
      setImageUploadError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setUploadingImage(false);
    }
  }
  function updateEnvio(patch: Partial<EnvioDraft>): void {
    setDrafts((current) => {
      const next = { ...current[activeEnvio], ...patch };
      scheduleEnvioSave(activeEnvio, next);
      return { ...current, [activeEnvio]: next };
    });
  }

  async function handlePublishClick(): Promise<void> {
    setValidationErrors([]);
    setValidating(true);
    try {
      const response = await fetch(`/api/sequence-templates/${template.id}/validate`, { method: 'POST' });
      const body = await response.json().catch(() => ({ valid: false, errors: ['No se pudo validar la plantilla.'] }));
      if (!response.ok || !body.valid) {
        setValidationErrors(body.errors ?? ['No se pudo validar la plantilla.']);
        return;
      }
      setShowModal(true);
    } finally {
      setValidating(false);
    }
  }

  async function handleConfirmPublish(): Promise<void> {
    setPublishError(null);
    setPublishing(true);
    try {
      const response = await fetch(`/api/sequence-templates/${template.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPublishError(body.error ?? 'No se pudo publicar la plantilla.');
        return;
      }
      setShowModal(false);
      router.refresh();
      const refreshed = await fetch(`/api/sequence-templates/${template.id}`).then((r) => r.json());
      setTemplate(refreshed);
    } catch {
      setPublishError('No se pudo contactar la API.');
    } finally {
      setPublishing(false);
    }
  }

  /** §12-14 — preflight: Mr Outreach's own local estimate of affected active Gestiones, before the confirmation modal or any motor call. */
  async function handleUpdateClick(): Promise<void> {
    setValidationErrors([]);
    setUpdateError(null);
    setValidating(true);
    try {
      const response = await fetch(`/api/sequence-templates/${template.id}/validate`, { method: 'POST' });
      const body = await response.json().catch(() => ({ valid: false, errors: ['No se pudo validar la plantilla.'] }));
      if (!response.ok || !body.valid) {
        setValidationErrors(body.errors ?? ['No se pudo validar la plantilla.']);
        return;
      }
      setUpdateImpactLoading(true);
      const impactResponse = await fetch(`/api/sequence-templates/${template.id}/update-impact`, { method: 'POST' });
      const impactBody = await impactResponse.json().catch(() => null);
      setUpdateImpact(impactResponse.ok ? impactBody : null);
      setShowUpdateModal(true);
    } finally {
      setValidating(false);
      setUpdateImpactLoading(false);
    }
  }

  async function handleConfirmUpdate(): Promise<void> {
    setUpdateError(null);
    setUpdating(true);
    try {
      const response = await fetch(`/api/sequence-templates/${template.id}/publish-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setUpdateError(body.error ?? 'No se pudo actualizar la plantilla.');
        return;
      }
      setShowUpdateModal(false);
      setEditingUnlocked(false);
      router.refresh();
      const refreshed = await fetch(`/api/sequence-templates/${template.id}`).then((r) => r.json());
      setTemplate(refreshed);
    } catch {
      setUpdateError('No se pudo contactar la API.');
    } finally {
      setUpdating(false);
    }
  }

  /** §13 — opens the confirmation gate before a PUBLISHED Plantilla's fields become editable; reuses the same local estimate as the final "Publicar actualización" modal. */
  async function openEditGate(): Promise<void> {
    setShowEditGateModal(true);
    setEditGateLoading(true);
    try {
      const response = await fetch(`/api/sequence-templates/${template.id}/update-impact`, { method: 'POST' });
      const body = await response.json().catch(() => null);
      setEditGateActiveExecutions(response.ok ? body.activeExecutionsCount : null);
    } finally {
      setEditGateLoading(false);
    }
  }

  function confirmEditGate(): void {
    setEditingUnlocked(true);
    setShowEditGateModal(false);
  }

  async function archive(): Promise<void> {
    setArchiving(true);
    try {
      await fetch(`/api/sequence-templates/${template.id}/archive`, { method: 'POST' });
      router.push('/dashboard/sequence-templates');
      router.refresh();
    } finally {
      setArchiving(false);
    }
  }

  /** §11 — reopens an archived Plantilla as an editable draft; must be published again (new version, new token) to become usable. */
  async function reopen(): Promise<void> {
    setReopening(true);
    try {
      const response = await fetch(`/api/sequence-templates/${template.id}/reopen`, { method: 'POST' });
      if (response.ok) {
        const body = (await response.json()) as SequenceTemplateDetail;
        setTemplate(body);
        router.refresh();
      }
    } finally {
      setReopening(false);
    }
  }

  /** §8-10 — single "Eliminar" action; the confirmation copy depends on the Plantilla's current status. */
  async function deleteTemplate(): Promise<void> {
    const confirmText =
      template.status === 'ARCHIVED'
        ? 'Esta plantilla archivada dejará de estar disponible. El historial relacionado con Gestiones anteriores se conservará. ¿Deseas continuar?'
        : template.status === 'PUBLISHED'
          ? 'Esta plantilla dejará de estar disponible para nuevas Gestiones. El historial de Gestiones anteriores se conservará. ¿Deseas continuar?'
          : 'Esta Plantilla todavía no ha sido publicada. Al eliminarla se perderá toda su configuración. ¿Deseas continuar?';
    if (!window.confirm(confirmText)) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/sequence-templates/${template.id}`, { method: 'DELETE' });
      if (response.ok) {
        router.push('/dashboard/sequence-templates');
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            {/* §1 (Fase 1.7) — the executive-chosen name; identical across every version of this Plantilla. */}
            <h1 className="flex-1 text-lg font-semibold text-slate-900">{template.name}</h1>
            <span className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {STATUS_LABELS[template.status]}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Cuenta: {template.mailboxEmail} · Cliente: {template.clientName ?? '—'} · Dominio: {template.domainName ?? '—'}
          </p>

          {/* §12 — versioned status, always visible: which version is live and how many Gestiones depend on it, plus whether a new one is currently being drafted. */}
          {template.latestPublishedVersion && (
            <p className="text-xs text-slate-600">
              Versión {template.latestPublishedVersion.versionNumber} · Publicada
              {template.activeExecutionsCount > 0
                ? ` y utilizada por ${template.activeExecutionsCount} Gestión${template.activeExecutionsCount === 1 ? '' : 'es'} activa${template.activeExecutionsCount === 1 ? '' : 's'}`
                : ', sin Gestiones activas'}
              {isPublished && editingUnlocked && (
                <>
                  {' · '}
                  <span className="font-medium text-amber-700">
                    Versión {nextDraftVersionNumber}: borrador en edición
                  </span>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {isArchived && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p>Esta plantilla está archivada. Para editarla, ábrela nuevamente como borrador.</p>
          {canUpdate && (
            <button
              type="button"
              onClick={reopen}
              disabled={reopening}
              className="whitespace-nowrap rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              {reopening ? 'Reabriendo…' : 'Editar (reabrir como borrador)'}
            </button>
          )}
        </div>
      )}

      {/* §11-13 — a PUBLISHED template's content stays locked until the executive explicitly starts a new version. */}
      {isPublished && !editingUnlocked && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p>Esta plantilla está publicada. Para modificar su contenido, crea una nueva versión en borrador.</p>
          {canUpdate && (
            <button
              type="button"
              onClick={openEditGate}
              className="whitespace-nowrap rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            >
              Editar plantilla publicada
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 border-b border-slate-200">
        {([1, 2, 3] as const).map((stepNumber) => (
          <button
            key={stepNumber}
            type="button"
            onClick={() => setActiveEnvio(stepNumber)}
            className={`px-4 py-2 text-sm font-medium ${
              activeEnvio === stepNumber ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'
            }`}
          >
            Envío {stepNumber}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
        {/* §3/§4 — Asunto lives inside Envío 1, editable only there; Envíos 2/3 show it read-only, always in sync. */}
        {activeEnvio === 1 ? (
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Asunto
            <div className="flex gap-1.5">
              <input
                value={subjectTemplate}
                disabled={!canUpdate || isLocked}
                onChange={(event) => updateSubject(event.target.value)}
                placeholder="Hola {contact_name}, información para {company_name}"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              />
              <VariableInsertMenu variables={variablesForEditor} onInsert={(key) => updateSubject(`${subjectTemplate}{${key}}`)} />
            </div>
            <span className="text-xs text-slate-500">Un único asunto, compartido por los 3 envíos.</span>
          </label>
        ) : (
          <div className="flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Asunto heredado del Envío 1</span>
            <span className="text-slate-800">{subjectTemplate || '—'}</span>
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Header opcional de este envío
          <div className="flex gap-1.5">
            <textarea
              value={currentDraft.headerText ?? ''}
              disabled={!canUpdate || isLocked}
              onChange={(event) => updateEnvio({ headerText: event.target.value })}
              rows={2}
              placeholder="Hola {contact_name},"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
            <VariableInsertMenu
              variables={variablesForEditor}
              onInsert={(key) => updateEnvio({ headerText: `${currentDraft.headerText ?? ''}{${key}}` })}
            />
          </div>
          <span className="text-xs text-slate-500">
            Texto breve y opcional que aparecerá antes del cuerpo de este envío. Puedes utilizar variables.
          </span>
        </label>

        <div className="flex gap-2 border-b border-slate-100 text-xs">
          <button
            type="button"
            onClick={() => setTab('editor')}
            className={`px-2 py-1.5 font-medium ${tab === 'editor' ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'}`}
          >
            Editor
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`px-2 py-1.5 font-medium ${tab === 'preview' ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'}`}
          >
            Vista previa
          </button>
        </div>

        {tab === 'editor' ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Cuerpo del Envío {activeEnvio}</span>
            <RichTextEditor
              value={currentDraft.bodyHtml}
              onChange={(html) => updateEnvio({ bodyHtml: html })}
              editable={canUpdate && !isLocked}
              variables={variablesForEditor}
            />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-xl overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-medium text-slate-500">Asunto: </span>
              {subjectTemplate}
            </div>
            <iframe
              title={`Vista previa Envío ${activeEnvio}`}
              srcDoc={buildPreviewDocument(currentDraft.headerText ?? '', currentDraft.bodyHtml, signatureHtml, variablesForEditor)}
              sandbox="allow-same-origin"
              className="h-96 w-full border-0"
            />
          </div>
        )}

        <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">Programación</legend>

          {activeEnvio !== 1 && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Días hábiles después del Envío {activeEnvio - 1}
                <input
                  type="number"
                  min={MIN_DELAY_DAYS}
                  max={MAX_DELAY_DAYS}
                  step={1}
                  value={currentDraft.delayValue}
                  disabled={!canUpdate || isLocked}
                  onChange={(event) => updateEnvio({ delayValue: Number(event.target.value) })}
                  className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
              <span className="pb-1.5 text-xs text-slate-500">
                Solo días hábiles (lunes a viernes), entre {MIN_DELAY_DAYS} y {MAX_DELAY_DAYS}.
              </span>
            </div>
          )}

          {/* §1-3 — fixed, non-configurable schedule: no day selector, no time-window inputs anywhere. */}
          <p className="text-xs text-slate-500">
            {template.steps.find((s) => s.stepNumber === activeEnvio)?.scheduleDescription}
          </p>
        </fieldset>
      </div>

      {/* §11 (Fase Firma) — signature belongs to this Plantilla, not to the mailbox: authored here, frozen into each publish/version, never edited from the account's own screen anymore. */}
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Firma</span>
          {canUpdate && !isLocked && (
            <>
              <input
                ref={signatureImageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif"
                className="hidden"
                onChange={handleSignatureImageSelected}
              />
              <button
                type="button"
                onClick={() => signatureImageInputRef.current?.click()}
                disabled={uploadingImage}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
              >
                {uploadingImage ? 'Subiendo…' : 'Agregar imagen'}
              </button>
            </>
          )}
        </div>
        <span className="text-xs text-slate-500">
          Se incluye en los 3 envíos de esta plantilla. Al publicar una nueva versión, la firma queda
          fija junto con el resto del contenido — las Gestiones ya iniciadas conservan la firma de su
          propia versión. Imágenes: PNG, JPG o GIF, hasta 1200x500 px y 1 MB.
        </span>
        {imageUploadError && <p className="text-xs text-red-600">{imageUploadError}</p>}
        <RichTextEditor
          value={signatureHtml}
          onChange={updateSignature}
          editable={canUpdate && !isLocked}
          placeholder="Nombre, cargo, empresa, teléfono…"
        />
      </div>

      {canPublish && !isLocked && (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          {validationErrors.length > 0 && (
            <ul className="list-inside list-disc rounded-md bg-red-50 p-3 text-sm text-red-700">
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          {/* §12 — a PUBLISHED template is edited via a distinct "actualizar" flow (new version, impact modal, SEQUENCE_TEMPLATE_UPDATE); the first-ever publish uses the plain flow instead. */}
          {isPublished ? (
            <button
              type="button"
              onClick={handleUpdateClick}
              disabled={validating || updateImpactLoading}
              className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {validating || updateImpactLoading ? 'Preparando actualización…' : 'Publicar actualización'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePublishClick}
              disabled={validating}
              className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {validating ? 'Validando…' : 'Publicar plantilla'}
            </button>
          )}
        </div>
      )}

      {template.versions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700">Versiones</h2>
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="pr-4">Versión</th>
                <th className="pr-4">Estado</th>
                <th className="pr-4">Token</th>
                <th className="pr-4">Publicada</th>
              </tr>
            </thead>
            <tbody>
              {template.versions.map((version) => (
                <tr key={version.id}>
                  <td className="pr-4 py-1">v{version.versionNumber}</td>
                  <td className="pr-4 py-1">{version.status}</td>
                  <td className="pr-4 py-1 font-mono text-xs">{version.templateTokenMasked ?? '—'}</td>
                  <td className="pr-4 py-1">
                    {version.acceptedAt ? new Date(version.acceptedAt).toLocaleString('es-CL') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {canArchive && !isArchived && (
            <button
              type="button"
              onClick={archive}
              disabled={archiving}
              className="self-start rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {archiving ? 'Archivando…' : 'Archivar plantilla'}
            </button>
          )}
          {/* §8-10 — DRAFT/PUBLISH_FAILED and ARCHIVED are always deletable; PUBLISHED only when no Gestión is still active against it. */}
          {canArchive && (template.status === 'DRAFT' || template.status === 'PUBLISH_FAILED' || isArchived) && (
            <button
              type="button"
              onClick={deleteTemplate}
              disabled={deleting}
              className="self-start rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? 'Eliminando…' : isArchived ? 'Eliminar plantilla archivada' : 'Eliminar plantilla'}
            </button>
          )}
          {canArchive && isPublished && (
            <button
              type="button"
              onClick={deleteTemplate}
              disabled={deleting || !deletability || !deletability.canDelete}
              title={
                deletability && !deletability.canDelete
                  ? 'Esta plantilla no puede eliminarse porque está siendo utilizada por una o más Gestiones activas.'
                  : undefined
              }
              className="self-start rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? 'Eliminando…' : 'Eliminar plantilla'}
            </button>
          )}
        </div>
        {canArchive && isPublished && deletability && !deletability.canDelete && (
          <p className="text-xs text-red-600">
            Esta plantilla no puede eliminarse porque está siendo utilizada por {deletability.activeExecutionsCount} Gestión
            {deletability.activeExecutionsCount === 1 ? '' : 'es'} activa{deletability.activeExecutionsCount === 1 ? '' : 's'}.
          </p>
        )}
      </div>

      {showModal && (
        <PublishConfirmationModal
          clientName={template.clientName}
          mailboxEmail={template.mailboxEmail}
          templateName={template.name}
          subjectTemplate={subjectTemplate}
          signatureHtml={signatureHtml}
          timezone={template.timezone}
          envios={([1, 2, 3] as const).map((stepNumber) => ({
            stepNumber,
            headerText: drafts[stepNumber].headerText,
            bodyHtml: drafts[stepNumber].bodyHtml,
            scheduleDescription: template.steps.find((s) => s.stepNumber === stepNumber)?.scheduleDescription ?? '',
          }))}
          publishing={publishing}
          error={publishError}
          onCancel={() => setShowModal(false)}
          onConfirm={handleConfirmPublish}
        />
      )}

      {showUpdateModal && (
        <UpdateTemplateConfirmationModal
          templateName={template.name}
          impact={updateImpact}
          modifiedFieldsSummary=""
          updating={updating}
          error={updateError}
          onCancel={() => setShowUpdateModal(false)}
          onConfirm={handleConfirmUpdate}
        />
      )}

      {showEditGateModal && (
        <EditPublishedTemplateModal
          activeExecutionsCount={editGateActiveExecutions}
          loadingImpact={editGateLoading}
          onCancel={() => setShowEditGateModal(false)}
          onConfirm={confirmEditGate}
        />
      )}
    </div>
  );
}
