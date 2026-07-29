'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssigneeSummary,
  ClientAssigneeSummary,
  ConversationTreeClientNode,
  DomainSummary,
  MailboxSummary,
  ManagedClientSummary,
  SchedulePreview,
  SequenceReadiness,
  SequenceStepSummary,
  SequenceSummary,
  UploadImportResult,
} from '@outreach/shared-types';
import { sanitizeRichTextHtml } from '../../../lib/sanitize-html-client';
import { RichTextEditor } from '../../rich-text-editor/rich-text-editor';
import { VariableInsertMenu } from '../../rich-text-editor/variable-insert-menu';
import { Modal } from '../../ui/modal';

const WIZARD_STEPS = [
  'Configuración general',
  'Importación del archivo',
  'Mapeo de columnas',
  'Variables',
  'Configuración de steps',
] as const;

const BASE_VARIABLES = [
  { key: 'empresa', label: 'Empresa' },
  { key: 'nombre_contacto', label: 'Nombre del contacto' },
  { key: 'correo_contacto', label: 'Correo del contacto' },
];

const VARIABLE_NAME_PATTERN = /^[a-z0-9_]+$/;

const DELAY_UNIT_LABEL: Record<string, string> = {
  MINUTES: 'minutos',
  HOURS: 'horas',
  DAYS: 'días',
  BUSINESS_DAYS: 'días hábiles',
};

const WEEKDAYS: Array<{ code: string; label: string }> = [
  { code: 'MON', label: 'Lun' },
  { code: 'TUE', label: 'Mar' },
  { code: 'WED', label: 'Mié' },
  { code: 'THU', label: 'Jue' },
  { code: 'FRI', label: 'Vie' },
  { code: 'SAT', label: 'Sáb' },
  { code: 'SUN', label: 'Dom' },
];

/** §5 — YYYY-MM-DD calendar date → "Gestión_DDMMYYYY", mirrors sequence-timing.util.ts's generateSequenceName exactly. */
function previewSequenceName(managementDate: string): string {
  if (!managementDate) return 'Gestión_—';
  const [year, month, day] = managementDate.split('-');
  if (!year || !month || !day) return 'Gestión_—';
  return `Gestión_${day}${month}${year}`;
}

function describeDays(days: string[]): string {
  const set = new Set(days);
  if (['MON', 'TUE', 'WED', 'THU', 'FRI'].every((d) => set.has(d)) && set.size === 5) {
    return 'lunes a viernes';
  }
  const labels: Record<string, string> = {
    MON: 'lunes',
    TUE: 'martes',
    WED: 'miércoles',
    THU: 'jueves',
    FRI: 'viernes',
    SAT: 'sábado',
    SUN: 'domingo',
  };
  return WEEKDAYS.filter((w) => set.has(w.code))
    .map((w) => labels[w.code])
    .join(', ');
}

/** §7 — "lunes 27 de julio de 2026, desde las 08:00", in America/Santiago regardless of the viewer's own timezone. */
function formatEstimated(iso: string): string {
  const date = new Date(iso);
  const tz = { timeZone: 'America/Santiago' } as const;
  const weekday = date.toLocaleDateString('es-CL', { weekday: 'long', ...tz });
  const day = date.toLocaleDateString('es-CL', { day: 'numeric', ...tz });
  const month = date.toLocaleDateString('es-CL', { month: 'long', ...tz });
  const year = date.toLocaleDateString('es-CL', { year: 'numeric', ...tz });
  const time = date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, ...tz });
  return `${weekday} ${day} de ${month} de ${year}, desde las ${time}`;
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}

/** §3 — representative sample data for the preview, decoupled from any real uploaded contact. */
const EXAMPLE_VALUES: Record<string, string> = {
  empresa: 'Empresa Ejemplo',
  nombre_contacto: 'María',
  nombre: 'María',
  correo_contacto: 'maria@empresaejemplo.cl',
  correo: 'maria@empresaejemplo.cl',
  cargo: 'Gerente de Operaciones',
  rubro: 'Tecnología',
  industria: 'Tecnología',
};

function exampleValueFor(key: string): string {
  return EXAMPLE_VALUES[key] ?? 'Valor de ejemplo';
}

const VOID_HTML_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** §3 — a lightweight unclosed/mismatched-tag check, to warn when hand-edited HTML source may not render as expected. */
function hasInvalidHtml(html: string): boolean {
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    const tag = match[1].toLowerCase();
    if (VOID_HTML_TAGS.has(tag) || match[0].endsWith('/>')) continue;
    if (match[0].startsWith('</')) {
      if (stack.length === 0 || stack[stack.length - 1] !== tag) return true;
      stack.pop();
    } else {
      stack.push(tag);
    }
  }
  return stack.length > 0;
}

interface StepDraft {
  subject: string;
  htmlHeader: string;
  htmlBody: string;
}

/** Spec §1.1 paso 3 — a mailbox may only be picked once it's actually vinculada and error-free. */
function isMailboxEligible(mailbox: MailboxSummary): boolean {
  return (
    mailbox.status === 'ACTIVE' &&
    mailbox.connectionStatus === 'CONNECTED' &&
    mailbox.provisioningStatus === 'PROVISIONED'
  );
}

/**
 * `mode="admin"` (spec §3): the admin picks Cliente → Cuenta de correo →
 * Ejecutivo responsable (in that order, per the spec's explicit flow) —
 * everything after step 1 is identical to the self-service wizard. In this
 * mode `clients` is the org-wide CONFIGURADO client list (not "assigned to
 * me"), and the mailbox/executive options are fetched reactively per
 * selected client instead of coming from a pre-loaded tree.
 */
export function SequenceWizard({
  clients,
  tree = [],
  mode = 'self',
}: {
  clients: Pick<ManagedClientSummary, 'id' | 'name'>[];
  tree?: ConversationTreeClientNode[];
  mode?: 'self' | 'admin';
}) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Fase 2 — generated once per mount, reused on every retry of the same
  // "iniciar secuencia" attempt so a retry never duplicates the import
  // confirmation or the sequence publish (see ConfirmProspectImportUseCase /
  // PublishSequenceUseCase, both now require a client-generated Idempotency-Key header).
  const [confirmImportIdempotencyKey] = useState(() => crypto.randomUUID());
  const [publishIdempotencyKey] = useState(() => crypto.randomUUID());

  // Step 1
  const [clientId, setClientId] = useState('');
  const [domainId, setDomainId] = useState('');
  const [mailboxId, setMailboxId] = useState('');
  const [managementDate, setManagementDate] = useState('');
  const [sequence, setSequence] = useState<SequenceSummary | null>(null);
  const [steps, setSteps] = useState<SequenceStepSummary[]>([]);
  const [signatureHtml, setSignatureHtml] = useState('');

  // Step 1 — admin mode only (spec §1: Cliente → Dominio → Cuenta de correo → Ejecutivo responsable)
  const [executiveId, setExecutiveId] = useState('');
  const [adminDomains, setAdminDomains] = useState<DomainSummary[]>([]);
  const [adminMailboxes, setAdminMailboxes] = useState<MailboxSummary[]>([]);
  const [assignableExecutives, setAssignableExecutives] = useState<ClientAssigneeSummary[]>([]);
  const [mailboxAssigneeIds, setMailboxAssigneeIds] = useState<string[] | null>(null);
  const [authorizeMailboxAssignment, setAuthorizeMailboxAssignment] = useState(false);

  // Cliente → Dominio (+ ejecutivos asignados a ese cliente, cargados en paralelo).
  useEffect(() => {
    if (mode !== 'admin' || !clientId) {
      setAdminDomains([]);
      setAssignableExecutives([]);
      return;
    }
    fetch(`/api/clients/${clientId}/domains`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body: DomainSummary[]) => {
        const activeDomains = body.filter((domain) => domain.status === 'ACTIVE');
        setAdminDomains(activeDomains);
        // Auto-selecciona si hay un solo dominio activo (spec §1.1 paso 2).
        setDomainId(activeDomains.length === 1 ? activeDomains[0].id : '');
      })
      .catch(() => setAdminDomains([]));
    fetch(`/api/clients/${clientId}/assignees`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body: ClientAssigneeSummary[]) => setAssignableExecutives(body.filter((a) => a.status === 'ACTIVE')))
      .catch(() => setAssignableExecutives([]));
  }, [mode, clientId]);

  // Dominio → Cuenta de correo (solo elegibles: activa, conectada y aprovisionada).
  useEffect(() => {
    if (mode !== 'admin' || !domainId) {
      setAdminMailboxes([]);
      return;
    }
    fetch(`/api/domains/${domainId}/mailboxes`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body: MailboxSummary[]) => {
        const eligible = body.filter(isMailboxEligible);
        setAdminMailboxes(eligible);
        setMailboxId(eligible.length === 1 ? eligible[0].id : '');
      })
      .catch(() => setAdminMailboxes([]));
  }, [mode, domainId]);

  useEffect(() => {
    if (mode !== 'admin' || !mailboxId) {
      setMailboxAssigneeIds(null);
      return;
    }
    setAuthorizeMailboxAssignment(false);
    fetch(`/api/mailboxes/${mailboxId}/assignees`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body: AssigneeSummary[]) => setMailboxAssigneeIds(body.map((a) => a.id)))
      .catch(() => setMailboxAssigneeIds([]));
  }, [mode, mailboxId]);

  const mailboxNeedsAuthorization =
    mode === 'admin' &&
    !!executiveId &&
    mailboxAssigneeIds !== null &&
    !mailboxAssigneeIds.includes(executiveId);

  // Step 2
  const [uploadResult, setUploadResult] = useState<UploadImportResult | null>(null);

  // Step 3
  const [mapEmail, setMapEmail] = useState('');
  const [mapFirstName, setMapFirstName] = useState('');
  const [mapLastName, setMapLastName] = useState('');
  const [mapCompany, setMapCompany] = useState('');

  // Step 4
  const [customVariables, setCustomVariables] = useState<Array<{ name: string; column: string }>>([]);
  const [newVarName, setNewVarName] = useState('');
  const [newVarColumn, setNewVarColumn] = useState('');
  const [mappingSubmitted, setMappingSubmitted] = useState<{
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    excludedRows: number;
  } | null>(null);

  // Step 5
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});
  const [sameHeaderForAll, setSameHeaderForAll] = useState(false);
  const [tabByStep, setTabByStep] = useState<Record<string, 'editor' | 'preview'>>({});
  const [iframeHeights, setIframeHeights] = useState<Record<string, number>>({});
  const [scheduleDays, setScheduleDays] = useState<string[]>(['MON', 'TUE', 'WED', 'THU', 'FRI']);
  const [windowStart, setWindowStart] = useState('08:00');
  const [windowEnd, setWindowEnd] = useState('19:00');
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startResult, setStartResult] = useState<{ status: string; effectiveStartAt: string | null } | null>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const mailboxOptions = useMemo(() => {
    if (mode === 'admin') {
      const domainName = adminDomains.find((d) => d.id === domainId)?.domainName ?? '';
      return adminMailboxes.map((mailbox) => ({ id: mailbox.id, email: mailbox.email, domainName }));
    }
    const client = tree.find((node) => node.id === clientId);
    if (!client) return [];
    return client.domains.flatMap((domain) =>
      domain.mailboxes.map((mailbox) => ({ id: mailbox.id, email: mailbox.email, domainName: domain.domainName })),
    );
  }, [mode, adminMailboxes, adminDomains, domainId, tree, clientId]);

  const availableColumns = uploadResult?.headers ?? [];
  const mappedColumns = new Set([mapEmail, mapFirstName, mapLastName, mapCompany, ...customVariables.map((v) => v.column)]);
  const unusedColumns = availableColumns.filter((column) => !mappedColumns.has(column));

  const variablesForEditor = useMemo(
    () => [...BASE_VARIABLES, ...customVariables.map((v) => ({ key: v.name, label: v.name }))],
    [customVariables],
  );

  const step1 = steps.find((s) => s.position === 1);

  // Admin routes drop the /me prefix entirely (org-scoped, not owner-scoped — see SequencesController/SequenceImportsController).
  const seqBase = mode === 'admin' ? '/api/sequences' : '/api/me/sequences';
  const importBase = mode === 'admin' ? '/api/sequence-imports' : '/api/me/sequence-imports';
  const stepBase = mode === 'admin' ? '/api/sequence-steps' : '/api/me/sequence-steps';
  const mailboxBase = mode === 'admin' ? '/api/mailboxes' : '/api/me/mailboxes';

  function goTo(next: number): void {
    setError(null);
    setStep(next);
  }

  // ---- Step 1: Configuración general ----
  async function submitGeneral(): Promise<void> {
    if (!clientId || !mailboxId || !managementDate) {
      setError('Selecciona cliente, cuenta de correo y fecha de gestión.');
      return;
    }
    if (mode === 'admin' && !domainId) {
      setError('Selecciona el dominio.');
      return;
    }
    if (mode === 'admin' && !executiveId) {
      setError('Selecciona el ejecutivo responsable.');
      return;
    }
    if (mode === 'admin' && mailboxNeedsAuthorization && !authorizeMailboxAssignment) {
      setError('Esta cuenta no está asignada al ejecutivo — autoriza la asignación para continuar.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const createUrl = mode === 'admin' ? `/api/users/${executiveId}/sequences/wizard` : `${seqBase}/wizard`;
      const createBody =
        mode === 'admin'
          ? { clientId, domainId, mailboxId, managementDate, authorizeMailboxAssignment }
          : { clientId, mailboxId, managementDate };
      const response = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
      });
      const body = await readJsonSafe(response);
      if (!response.ok) {
        setError((body.error as string) ?? 'No se pudo crear la secuencia.');
        return;
      }
      const createdSequence = body as unknown as SequenceSummary;
      setSequence(createdSequence);
      setScheduleDays(createdSequence.schedule.days);
      setWindowStart(createdSequence.schedule.windows[0]?.start ?? '08:00');
      setWindowEnd(createdSequence.schedule.windows[0]?.end ?? '19:00');
      const stepsResponse = await fetch(`${seqBase}/${createdSequence.id}/steps`);
      const stepsBody = (await stepsResponse.json()) as SequenceStepSummary[];
      setSteps(stepsBody);
      setStepDrafts(
        Object.fromEntries(
          stepsBody.map((s) => [s.id, { subject: s.subject, htmlHeader: s.htmlHeader ?? '', htmlBody: s.htmlBody }]),
        ),
      );
      // Best-effort — a mailbox without a configured signature simply previews without one.
      fetch(`${mailboxBase}/${mailboxId}/signature/preview`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body2) => setSignatureHtml(body2?.renderedHtml ?? ''))
        .catch(() => setSignatureHtml(''));
      goTo(2);
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setPending(false);
    }
  }

  // ---- Step 2: Importación .xlsx ----
  async function handleFileSelected(file: File): Promise<void> {
    if (!sequence) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Solo se permiten archivos .xlsx.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch(`${seqBase}/${sequence.id}/imports`, {
        method: 'POST',
        body: formData,
      });
      const body = await readJsonSafe(response);
      if (!response.ok) {
        setError((body.error as string) ?? 'No se pudo procesar el archivo.');
        return;
      }
      setUploadResult(body as unknown as UploadImportResult);
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setPending(false);
    }
  }

  // ---- Step 3 -> 4: local only, validated on the Step 4 -> 5 transition ----
  function submitMappingFields(): void {
    if (!mapEmail || !mapFirstName || !mapCompany) {
      setError('Correo, nombre del contacto y empresa son obligatorios.');
      return;
    }
    goTo(4);
  }

  function addCustomVariable(): void {
    const name = newVarName.trim().toLowerCase();
    if (!name || !newVarColumn) return;
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      setError('El nombre de la variable solo puede tener minúsculas, números y guion bajo, sin espacios.');
      return;
    }
    if (BASE_VARIABLES.some((v) => v.key === name) || customVariables.some((v) => v.name === name)) {
      setError('Ya existe una variable con ese nombre.');
      return;
    }
    setError(null);
    setCustomVariables((current) => [...current, { name, column: newVarColumn }]);
    setNewVarName('');
    setNewVarColumn('');
  }

  function removeCustomVariable(name: string): void {
    setCustomVariables((current) => current.filter((v) => v.name !== name));
  }

  async function submitVariablesAndMapping(): Promise<void> {
    if (!uploadResult) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${importBase}/${uploadResult.import.id}/mapping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: mapEmail,
          firstName: mapFirstName,
          lastName: mapLastName || undefined,
          company: mapCompany,
          customFields: Object.fromEntries(customVariables.map((v) => [v.name, v.column])),
        }),
      });
      const body = await readJsonSafe(response);
      if (!response.ok) {
        setError((body.error as string) ?? 'No se pudo validar el mapeo.');
        return;
      }
      setMappingSubmitted({
        validRows: body.validRows as number,
        invalidRows: body.invalidRows as number,
        duplicateRows: body.duplicateRows as number,
        excludedRows: body.excludedRows as number,
      });
      goTo(5);
      void refreshSchedulePreview();
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setPending(false);
    }
  }

  // ---- Step 5 ----
  async function refreshSchedulePreview(): Promise<void> {
    if (!sequence) return;
    const response = await fetch(`${seqBase}/${sequence.id}/schedule-preview`);
    if (response.ok) setSchedulePreview((await response.json()) as SchedulePreview);
  }

  function updateDraft(stepId: string, patch: Partial<StepDraft>): void {
    setStepDrafts((current) => {
      const next = { ...current, [stepId]: { ...current[stepId], ...patch } };
      if (patch.htmlHeader !== undefined && sameHeaderForAll && step1?.id === stepId) {
        for (const s of steps) {
          if (s.id !== stepId) next[s.id] = { ...next[s.id], htmlHeader: patch.htmlHeader };
        }
      }
      return next;
    });
  }

  function toggleSameHeaderForAll(checked: boolean): void {
    setSameHeaderForAll(checked);
    if (checked && step1) {
      const headerFromStep1 = stepDrafts[step1.id]?.htmlHeader ?? '';
      setStepDrafts((current) => {
        const next = { ...current };
        for (const s of steps) next[s.id] = { ...next[s.id], htmlHeader: headerFromStep1 };
        return next;
      });
    }
  }

  function insertVariableAtCursor(key: string): void {
    const input = subjectInputRef.current;
    if (!step1) return;
    const current = stepDrafts[step1.id]?.subject ?? '';
    if (!input) {
      updateDraft(step1.id, { subject: `${current}{${key}}` });
      return;
    }
    const start = input.selectionStart ?? current.length;
    const end = input.selectionEnd ?? current.length;
    const nextValue = `${current.slice(0, start)}{${key}}${current.slice(end)}`;
    updateDraft(step1.id, { subject: nextValue });
    requestAnimationFrame(() => {
      input.focus();
      const cursor = start + key.length + 2;
      input.setSelectionRange(cursor, cursor);
    });
  }

  function substituteVariables(html: string): string {
    let result = html;
    for (const variable of variablesForEditor) {
      result = result.split(`{${variable.key}}`).join(exampleValueFor(variable.key));
    }
    return result;
  }

  function buildPreviewDocument(headerHtml: string, bodyHtml: string, signatureHtml: string): string {
    const header = headerHtml.trim() ? sanitizeRichTextHtml(substituteVariables(headerHtml)) : '';
    const body = sanitizeRichTextHtml(substituteVariables(bodyHtml));
    const signature = signatureHtml.trim() ? sanitizeRichTextHtml(signatureHtml) : '';
    return `<!doctype html><html><head><meta charset="utf-8" /><style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1e293b; background: #ffffff; }
      img { max-width: 100%; height: auto; }
      table { border-collapse: collapse; max-width: 100%; }
      a { color: #2563eb; }
    </style></head><body>
      ${header ? `<div style="padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid #e2e8f0;">${header}</div>` : ''}
      <div>${body}</div>
      ${signature ? `<div style="padding-top:16px;margin-top:24px;border-top:1px solid #e2e8f0;">${signature}</div>` : ''}
    </body></html>`;
  }

  function schedulingExplanation(s: SequenceStepSummary): string {
    const daysLabel = describeDays(scheduleDays);
    if (s.position === 1) {
      return `Se enviará al iniciar la secuencia, dentro de la ventana de ${daysLabel} entre las ${windowStart} y las ${windowEnd}, zona horaria America/Santiago.`;
    }
    const prev = steps.find((candidate) => candidate.position === s.position - 1);
    const unitLabel = DELAY_UNIT_LABEL[s.delayUnit] ?? s.delayUnit;
    return `Se enviará ${s.delayValue} ${unitLabel} después del envío efectivo de ${prev?.name ?? 'el step anterior'}, dentro de la ventana configurada.`;
  }

  /** §9 — validates everything in-page; never navigates away or uses window.alert. */
  async function handleStartClick(): Promise<void> {
    if (!sequence) return;
    setPending(true);
    setError(null);
    try {
      // Persist every edited field first, so readiness/validation reflect the latest drafts.
      for (const s of steps) {
        const draft = stepDrafts[s.id];
        if (!draft) continue;
        const patch: Record<string, unknown> = {};
        if (draft.htmlBody.trim() && draft.htmlBody !== s.htmlBody) patch.htmlBody = draft.htmlBody;
        if (s.position === 1 && draft.subject.trim() && draft.subject !== s.subject) patch.subject = draft.subject;
        if ((draft.htmlHeader || null) !== (s.htmlHeader ?? null)) patch.htmlHeader = draft.htmlHeader || null;
        if (Object.keys(patch).length === 0) continue;
        await fetch(`${stepBase}/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
      }
      const refreshedRes = await fetch(`${seqBase}/${sequence.id}/steps`);
      const refreshedSteps = (await refreshedRes.json()) as SequenceStepSummary[];
      setSteps(refreshedSteps);

      const errors: string[] = [];
      if (!uploadResult) errors.push('Debes cargar el archivo .xlsx de contactos.');
      if (!mappingSubmitted) errors.push('Debes completar el mapeo de columnas.');
      if (mappingSubmitted && mappingSubmitted.validRows === 0) errors.push('No hay contactos válidos para incorporar a la secuencia.');
      if (scheduleDays.length === 0) errors.push('Selecciona al menos un día habilitado para la ventana de envío.');
      if (windowStart >= windowEnd) errors.push('El horario de inicio debe ser anterior al horario de término.');
      const step1Refreshed = refreshedSteps.find((s) => s.position === 1);
      if (!step1Refreshed?.subject?.trim()) errors.push('Enviados_1 necesita un asunto.');
      for (const s of refreshedSteps) {
        if (!s.htmlBody?.trim()) errors.push(`${s.name} necesita contenido en el cuerpo del correo.`);
      }
      const allowedVariables = new Set(variablesForEditor.map((v) => v.key));
      for (const s of refreshedSteps) {
        const usedInSubject = s.position === 1 ? [...(s.subject.matchAll(/\{([a-z0-9_]+)\}/g) ?? [])] : [];
        const usedInBody = [...(s.htmlBody.matchAll(/\{([a-z0-9_]+)\}/g) ?? [])];
        const usedInHeader = s.htmlHeader ? [...(s.htmlHeader.matchAll(/\{([a-z0-9_]+)\}/g) ?? [])] : [];
        for (const match of [...usedInSubject, ...usedInBody, ...usedInHeader]) {
          if (!allowedVariables.has(match[1])) errors.push(`"{${match[1]}}" en ${s.name} no está mapeada a ninguna columna.`);
        }
      }

      const readinessRes = await fetch(`${seqBase}/${sequence.id}/readiness`);
      if (readinessRes.ok) {
        const readiness = (await readinessRes.json()) as SequenceReadiness;
        errors.push(...readiness.account.issues, ...readiness.steps.issues);
      }

      if (errors.length > 0) {
        setValidationErrors([...new Set(errors)]);
        return;
      }
      setValidationErrors([]);
      await refreshSchedulePreview();
      setConfirmOpen(true);
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setPending(false);
    }
  }

  async function confirmStart(): Promise<void> {
    if (!sequence || steps.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const firstStep = steps.find((s) => s.position === 1);
      if (firstStep && firstStep.status !== 'PUBLISHED') {
        await fetch(`${stepBase}/${firstStep.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'PUBLISHED' }),
        });
      }
      if (uploadResult) {
        // Fase 2, Caso B — confirm() is now synchronous and atomic; no
        // separate /advance call is needed to materialize contacts.
        await fetch(`${importBase}/${uploadResult.import.id}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': confirmImportIdempotencyKey },
          body: JSON.stringify({}),
        });
      }
      const response = await fetch(`${seqBase}/${sequence.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': publishIdempotencyKey },
        body: JSON.stringify({}),
      });
      const body = await readJsonSafe(response);
      if (!response.ok) {
        setConfirmOpen(false);
        setError((body.error as string) ?? 'No se pudo publicar la secuencia.');
        return;
      }
      const publishedSequence = (body as { sequence: SequenceSummary }).sequence;
      setStartResult({ status: publishedSequence.publishStatus ?? 'REQUESTED', effectiveStartAt: publishedSequence.effectiveStartAt });
      setSequence(publishedSequence);
      setConfirmOpen(false);
    } catch {
      setConfirmOpen(false);
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {WIZARD_STEPS.map((label, index) => (
          <li
            key={label}
            className={`rounded-full px-3 py-1 font-medium ${
              index + 1 === step
                ? 'bg-brand-600 text-white'
                : index + 1 < step
                  ? 'bg-brand-50 text-brand-700'
                  : 'bg-slate-100 text-slate-500'
            }`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {step === 1 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Configuración general</h2>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Cliente
              <select
                value={clientId}
                onChange={(event) => {
                  setClientId(event.target.value);
                  setDomainId('');
                  setMailboxId('');
                  setExecutiveId('');
                }}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              >
                <option value="">Selecciona un cliente…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            {mode === 'admin' && (
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Dominio
                <select
                  value={domainId}
                  onChange={(event) => {
                    setDomainId(event.target.value);
                    setMailboxId('');
                    setExecutiveId('');
                  }}
                  disabled={!clientId || adminDomains.length === 0}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50"
                >
                  <option value="">Selecciona un dominio…</option>
                  {adminDomains.map((domain) => (
                    <option key={domain.id} value={domain.id}>
                      {domain.domainName}
                    </option>
                  ))}
                </select>
                {clientId && adminDomains.length === 0 && (
                  <span className="text-[11px] text-amber-600">
                    Este cliente no tiene dominios configurados.{' '}
                    <Link href={`/dashboard/clients/${clientId}`} className="underline">
                      Debes agregar al menos un dominio antes de crear la secuencia.
                    </Link>
                  </span>
                )}
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Cuenta de correo remitente
              <select
                value={mailboxId}
                onChange={(event) => setMailboxId(event.target.value)}
                disabled={mode === 'admin' ? !domainId : !clientId}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50"
              >
                <option value="">Selecciona una cuenta…</option>
                {mailboxOptions.map((mailbox) => (
                  <option key={mailbox.id} value={mailbox.id}>
                    {mailbox.email} ({mailbox.domainName})
                  </option>
                ))}
              </select>
              {mode === 'admin' && domainId && mailboxOptions.length === 0 && (
                <span className="text-[11px] text-amber-600">
                  Este dominio no tiene cuentas de correo vinculadas y sin errores de conexión.
                </span>
              )}
              {mode === 'self' && clientId && mailboxOptions.length === 0 && (
                <span className="text-[11px] text-amber-600">Este cliente no tiene cuentas asignadas a tu usuario.</span>
              )}
            </label>
            {mode === 'admin' && (
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Ejecutivo responsable
                <select
                  value={executiveId}
                  onChange={(event) => setExecutiveId(event.target.value)}
                  disabled={!mailboxId}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50"
                >
                  <option value="">Selecciona un ejecutivo…</option>
                  {assignableExecutives.map((executive) => (
                    <option key={executive.id} value={executive.id}>
                      {executive.name} ({executive.email})
                    </option>
                  ))}
                </select>
                {clientId && assignableExecutives.length === 0 && (
                  <span className="text-[11px] text-amber-600">
                    Este cliente no tiene ejecutivos asignados todavía — asígnalo primero desde la ficha del
                    cliente.
                  </span>
                )}
                {mailboxNeedsAuthorization && (
                  <label className="mt-1 flex items-start gap-1.5 text-[11px] font-normal text-amber-700">
                    <input
                      type="checkbox"
                      checked={authorizeMailboxAssignment}
                      onChange={(event) => setAuthorizeMailboxAssignment(event.target.checked)}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    Esta cuenta no está asignada a este ejecutivo. Autorizar la asignación para continuar.
                  </label>
                )}
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Fecha de gestión
              <input
                type="date"
                value={managementDate}
                onChange={(event) => setManagementDate(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              />
            </label>
            <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Nombre de la secuencia
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-sm text-slate-700">
                {previewSequenceName(managementDate)}
              </div>
              <span className="text-[11px] font-normal text-slate-400">
                Generado automáticamente — no editable. Zona horaria: America/Santiago.
              </span>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void submitGeneral()}
                disabled={pending}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {pending ? 'Creando…' : 'Siguiente'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Importación del archivo</h2>
            <p className="text-xs text-slate-500">Solo se permiten archivos .xlsx.</p>
            <input
              type="file"
              accept=".xlsx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFileSelected(file);
              }}
              className="text-sm"
            />
            {uploadResult && (
              <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 text-xs text-slate-600">
                <p>
                  <span className="font-medium">{uploadResult.import.fileName}</span> — {uploadResult.import.totalRows}{' '}
                  filas detectadas
                </p>
                <p>Columnas: {uploadResult.headers.join(', ')}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[400px] border-collapse text-left text-[11px]">
                    <thead>
                      <tr>
                        {uploadResult.headers.map((header) => (
                          <th key={header} className="border-b border-slate-200 px-2 py-1 font-semibold text-slate-500">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.previewRows.slice(0, 5).map((row, index) => (
                        <tr key={index}>
                          {uploadResult.headers.map((header) => (
                            <td key={header} className="border-b border-slate-100 px-2 py-1 text-slate-700">
                              {row[header]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex justify-between">
              <button type="button" onClick={() => goTo(1)} className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
                Atrás
              </button>
              <button
                type="button"
                onClick={() => goTo(3)}
                disabled={!uploadResult}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {step === 3 && uploadResult && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Mapeo de columnas</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="pb-1">Campo de Mr Outreach</th>
                  <th className="pb-1">Columna del archivo</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {[
                  { label: 'Prospecto / Empresa*', value: mapCompany, set: setMapCompany },
                  { label: 'Nombre del contacto*', value: mapFirstName, set: setMapFirstName },
                  { label: 'Apellido', value: mapLastName, set: setMapLastName },
                  { label: 'Correo electrónico*', value: mapEmail, set: setMapEmail },
                ].map((row) => (
                  <tr key={row.label}>
                    <td className="py-1.5 pr-3 font-medium text-slate-700">{row.label}</td>
                    <td className="py-1.5">
                      <select
                        value={row.value}
                        onChange={(event) => row.set(event.target.value)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                      >
                        <option value="">—</option>
                        {uploadResult.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-400">* Obligatorio.</p>
            <div className="flex justify-between">
              <button type="button" onClick={() => goTo(2)} className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
                Atrás
              </button>
              <button
                type="button"
                onClick={submitMappingFields}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Variables</h2>
            <div className="flex flex-wrap gap-2">
              {BASE_VARIABLES.map((v) => (
                <span key={v.key} className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] text-slate-600">{`{${v.key}}`}</span>
              ))}
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Variables personalizadas</p>
              {customVariables.map((v) => (
                <div key={v.name} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-brand-700">{`{${v.name}}`}</span>
                  <span className="text-slate-500">← {v.column}</span>
                  <button type="button" onClick={() => removeCustomVariable(v.name)} className="text-red-600 hover:underline">
                    Quitar
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <input
                  value={newVarName}
                  onChange={(event) => setNewVarName(event.target.value)}
                  placeholder="nombre_variable"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                />
                <select
                  value={newVarColumn}
                  onChange={(event) => setNewVarColumn(event.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">Columna…</option>
                  {unusedColumns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addCustomVariable}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand-300 hover:text-brand-700"
                >
                  Agregar
                </button>
              </div>
            </div>
            <div className="flex justify-between">
              <button type="button" onClick={() => goTo(3)} className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
                Atrás
              </button>
              <button
                type="button"
                onClick={() => void submitVariablesAndMapping()}
                disabled={pending}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {pending ? 'Validando…' : 'Siguiente'}
              </button>
            </div>
          </div>
        )}

        {step === 5 && sequence && (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Configuración de steps</h2>
            {mappingSubmitted && (
              <p className="text-xs text-slate-500">
                {mappingSubmitted.validRows} filas válidas · {mappingSubmitted.invalidRows} inválidas ·{' '}
                {mappingSubmitted.duplicateRows} duplicadas · {mappingSubmitted.excludedRows} excluidas.
              </p>
            )}

            {steps.map((s) => {
              const draft = stepDrafts[s.id] ?? {
                subject: s.subject,
                htmlHeader: s.htmlHeader ?? '',
                htmlBody: s.htmlBody,
              };
              const tab = tabByStep[s.id] ?? 'editor';
              const estimatedAt = schedulePreview?.steps.find((p) => p.stepId === s.id)?.estimatedAt;

              return (
                <div key={s.id} className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.name}</h3>

                  {s.position === 1 ? (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-slate-600">Asunto</label>
                      <div className="flex gap-1.5">
                        <input
                          ref={subjectInputRef}
                          value={draft.subject}
                          onChange={(event) => updateDraft(s.id, { subject: event.target.value })}
                          placeholder="{nombre_contacto}, una propuesta para {empresa}"
                          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                        />
                        <VariableInsertMenu variables={variablesForEditor} onInsert={insertVariableAtCursor} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                      Asunto
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-500">
                        {stepDrafts[step1?.id ?? '']?.subject || step1?.subject || 'Asunto heredado desde Enviados_1'}
                      </div>
                      <span className="text-[11px] font-normal text-slate-400">Asunto heredado desde Enviados_1 — no editable.</span>
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600">Header (opcional)</span>
                      {s.position === 1 && (
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                          <input
                            type="checkbox"
                            checked={sameHeaderForAll}
                            onChange={(event) => toggleSameHeaderForAll(event.target.checked)}
                            className="rounded border-slate-300"
                          />
                          Usar el mismo header en todos los steps
                        </label>
                      )}
                    </div>
                    <input
                      value={draft.htmlHeader}
                      onChange={(event) => updateDraft(s.id, { htmlHeader: event.target.value })}
                      placeholder="Header opcional…"
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                    />
                  </div>

                  <div className="flex gap-2 border-b border-slate-100 text-xs">
                    <button
                      type="button"
                      onClick={() => setTabByStep((current) => ({ ...current, [s.id]: 'editor' }))}
                      className={`px-2 py-1.5 font-medium ${tab === 'editor' ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'}`}
                    >
                      Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setTabByStep((current) => ({ ...current, [s.id]: 'preview' }))}
                      className={`px-2 py-1.5 font-medium ${tab === 'preview' ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'}`}
                    >
                      Vista previa
                    </button>
                  </div>

                  {tab === 'editor' ? (
                    <RichTextEditor
                      value={draft.htmlBody}
                      onChange={(html) => updateDraft(s.id, { htmlBody: html })}
                      variables={variablesForEditor}
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      {(hasInvalidHtml(draft.htmlHeader) || hasInvalidHtml(draft.htmlBody)) && (
                        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                          ⚠ Se detectó HTML que podría no renderizarse correctamente (etiquetas sin cerrar o mal
                          anidadas).
                        </p>
                      )}
                      <div
                        className="mx-auto w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
                        style={{ maxWidth: 600 }}
                      >
                        <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          <span className="font-medium text-slate-500">Asunto: </span>
                          {substituteVariables(
                            s.position === 1 ? draft.subject : step1 ? stepDrafts[step1.id]?.subject ?? step1.subject : '',
                          )}
                        </div>
                        <iframe
                          title={`Vista previa de ${s.name}`}
                          srcDoc={buildPreviewDocument(draft.htmlHeader, draft.htmlBody, signatureHtml)}
                          sandbox="allow-same-origin"
                          className="w-full border-0"
                          style={{ height: iframeHeights[s.id] ?? 320 }}
                          onLoad={(event) => {
                            try {
                              const doc = event.currentTarget.contentDocument;
                              if (doc) {
                                const height = Math.min(Math.max(doc.body.scrollHeight + 24, 160), 900);
                                setIframeHeights((current) => ({ ...current, [s.id]: height }));
                              }
                            } catch {
                              // Cross-origin/sandbox access denied — keep the previous height.
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                    <p>{schedulingExplanation(s)}</p>
                    {estimatedAt && (
                      <p className="mt-0.5 font-medium text-slate-800">Envío estimado: {formatEstimated(estimatedAt)}</p>
                    )}
                  </div>
                </div>
              );
            })}

            {validationErrors.length > 0 && (
              <div className="flex flex-col gap-1 rounded-md bg-red-50 p-3 text-xs text-red-700">
                <p className="font-semibold">No se pudo iniciar la secuencia:</p>
                <ul className="list-disc pl-4">
                  {validationErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {startResult && (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Secuencia enviada al motor — estado: {startResult.status}.{' '}
                <Link href={mode === 'admin' ? '/dashboard/sequences' : '/dashboard/sequences/mine'} className="font-medium underline">
                  {mode === 'admin' ? 'Ver todas las secuencias →' : 'Ver mis secuencias →'}
                </Link>
              </p>
            )}

            <div className="flex justify-between">
              <button type="button" onClick={() => goTo(4)} className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
                Atrás
              </button>
              <button
                type="button"
                onClick={() => void handleStartClick()}
                disabled={pending || !!startResult}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {pending ? 'Validando…' : 'Iniciar Secuencia'}
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirmar inicio de secuencia">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Confirmar inicio de secuencia</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-slate-500">Cliente</dt>
            <dd className="text-slate-800">{clients.find((c) => c.id === clientId)?.name}</dd>
            <dt className="text-slate-500">Cuenta remitente</dt>
            <dd className="text-slate-800">{sequence?.mailboxEmail}</dd>
            {mode === 'admin' && (
              <>
                <dt className="text-slate-500">Ejecutivo responsable</dt>
                <dd className="text-slate-800">
                  {assignableExecutives.find((e) => e.id === executiveId)?.name}
                </dd>
              </>
            )}
            <dt className="text-slate-500">Fecha de gestión</dt>
            <dd className="text-slate-800">{managementDate}</dd>
            <dt className="text-slate-500">Nombre</dt>
            <dd className="font-mono text-slate-800">{sequence?.name}</dd>
            <dt className="text-slate-500">Contactos válidos</dt>
            <dd className="text-slate-800">{mappingSubmitted?.validRows ?? 0}</dd>
          </dl>
          {schedulePreview && (
            <div className="flex flex-col gap-1 rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
              {schedulePreview.steps.map((s) => (
                <p key={s.stepId}>
                  <span className="font-medium">{s.name}:</span> {formatEstimated(s.estimatedAt)}
                </p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmStart()}
              disabled={pending}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'Publicando…' : 'Confirmar e iniciar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
