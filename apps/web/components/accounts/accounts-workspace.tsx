'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type {
  ClientAssigneeSummary,
  ConversationClassification,
  ConversationDetail,
  ConversationSummary,
  ConversationTreeClientNode,
  ResponseOutcome,
  SequenceContactStatus,
} from '@outreach/shared-types';
import { sanitizeRichTextHtml } from '../../lib/sanitize-html-client';
import { AccountsTree, TreeSelection } from './accounts-tree';
import { ResponseOutcomeConfirmPayload, ResponseOutcomeModal } from './response-outcome-modal';
import { ThreadActionsMenu } from './thread-actions-menu';

const OUTCOME_TO_ACTION: Record<ResponseOutcome, 'not-interested' | 'do-not-contact' | 'interested' | 'refer'> = {
  NOT_INTERESTED: 'not-interested',
  DO_NOT_CONTACT: 'do-not-contact',
  INTERESTED: 'interested',
  REFERRED: 'refer',
};

const TERMINAL_CONTACT_STATUSES: SequenceContactStatus[] = [
  'REMOVED',
  'COMPLETED',
  'COMPLETED_MANUALLY',
  'UNSUBSCRIBED',
];

const CLASSIFICATION_LABEL: Record<ConversationClassification, string> = {
  INTERESTED: 'Interesado',
  NOT_INTERESTED: 'No interesado',
  REQUESTS_INFORMATION: 'Solicita información',
  FOLLOW_UP_LATER: 'Retomar más adelante',
  WRONG_CONTACT: 'Contacto equivocado',
  OUT_OF_OFFICE: 'Fuera de oficina',
  AUTOMATIC_REPLY: 'Respuesta automática',
  HARD_BOUNCE: 'Rebote permanente',
  SOFT_BOUNCE: 'Rebote temporal',
  UNSUBSCRIBE: 'Cancelación',
  UNCLASSIFIED: 'Sin clasificar',
};

const CLASSIFICATION_OPTIONS = Object.keys(CLASSIFICATION_LABEL) as ConversationClassification[];

/** §7 — exact required visible text for each outcome; the badge shown in the list, the detail header and the filter. */
const RESPONSE_OUTCOME_LABEL: Record<ResponseOutcome, string> = {
  NOT_INTERESTED: 'No interesado',
  DO_NOT_CONTACT: 'No Contactar',
  INTERESTED: 'Interesado',
  REFERRED: 'Deriva',
};

const RESPONSE_OUTCOME_STYLE: Record<ResponseOutcome, string> = {
  NOT_INTERESTED: 'bg-slate-100 text-slate-700',
  DO_NOT_CONTACT: 'bg-red-100 text-red-700',
  INTERESTED: 'bg-emerald-100 text-emerald-700',
  REFERRED: 'bg-brand-100 text-brand-700',
};

function ResponseOutcomeBadge({ outcome }: { outcome: ResponseOutcome | null }) {
  if (!outcome) return null;
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${RESPONSE_OUTCOME_STYLE[outcome]}`}>
      {RESPONSE_OUTCOME_LABEL[outcome]}
    </span>
  );
}

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours < 1) return 'hace instantes';
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

function selectionToFilter(selection: TreeSelection | null): { clientId?: string; domainId?: string; mailboxId?: string } {
  if (!selection) return {};
  if (selection.level === 'client') return { clientId: selection.clientId };
  if (selection.level === 'domain') return { clientId: selection.clientId, domainId: selection.domainId };
  return { clientId: selection.clientId, domainId: selection.domainId, mailboxId: selection.mailboxId };
}

export function AccountsWorkspace({
  tree,
  initialSelection,
  initialDetail,
  mode = 'self',
  basePath = '/api/me/conversations',
  executives = [],
  sequences = [],
}: {
  tree: ConversationTreeClientNode[];
  initialSelection: { clientId: string | null; domainId: string | null; mailboxId: string | null; conversationId: string | null };
  initialDetail: ConversationDetail | null;
  /** Spec §7 — admin reuses this exact component, scoped to one client, with extra filters and no "assign to me". */
  mode?: 'self' | 'admin';
  basePath?: string;
  executives?: ClientAssigneeSummary[];
  sequences?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const initialTreeSelection: TreeSelection | null = initialSelection.mailboxId
    ? { level: 'mailbox', clientId: initialSelection.clientId!, domainId: initialSelection.domainId!, mailboxId: initialSelection.mailboxId }
    : initialSelection.domainId
      ? { level: 'domain', clientId: initialSelection.clientId!, domainId: initialSelection.domainId }
      : initialSelection.clientId
        ? { level: 'client', clientId: initialSelection.clientId }
        : null;

  const [selection, setSelection] = useState<TreeSelection | null>(initialTreeSelection);
  const [treeState, setTreeState] = useState<ConversationTreeClientNode[]>(tree);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection.conversationId);
  const [detail, setDetail] = useState<ConversationDetail | null>(initialDetail);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showPlainText, setShowPlainText] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(Boolean(initialDetail));
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [outcomeModalOpen, setOutcomeModalOpen] = useState<ResponseOutcome | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // Admin-only filters (spec §7.3) — applied on top of the tree's mailbox selection.
  const [executiveFilter, setExecutiveFilter] = useState('');
  const [sequenceFilter, setSequenceFilter] = useState('');
  const [unreadFilter, setUnreadFilter] = useState('');
  const [classificationFilter, setClassificationFilter] = useState('');
  /** §7 — 'UNCLASSIFIED' is the "Sin clasificar" sentinel; '' means "Todos" (no filter applied). */
  const [responseOutcomeFilter, setResponseOutcomeFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');

  useEffect(() => {
    void refreshList(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the tree's unread counters in sync whenever the server component
  // re-renders with a fresh `tree` (e.g. a full navigation) — client-side
  // optimistic decrements (see `loadDetail`) happen in between these syncs.
  useEffect(() => {
    setTreeState(tree);
  }, [tree]);

  // §4 — "posicionar la vista en el mensaje que generó la alerta": scrolls to and briefly
  // highlights the newest inbound message whenever a conversation's detail loads (both from a
  // notification-bell deep link and from clicking it directly in the list — the newest reply is
  // always the one worth landing on).
  useEffect(() => {
    if (!detail) return;
    const lastInbound = [...detail.messages].reverse().find((m) => m.direction === 'INBOUND');
    if (!lastInbound) return;
    const element = document.getElementById(`message-${lastInbound.id}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(lastInbound.id);
    const timeout = setTimeout(() => setHighlightedMessageId(null), 2500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  /** §2 — only a mailbox ("cuenta de correo") selection shows conversations; client/domain selections just narrow the tree. */
  async function refreshList(nextSelection: TreeSelection | null): Promise<void> {
    if (nextSelection?.level !== 'mailbox') {
      setConversations([]);
      return;
    }
    setLoadingList(true);
    try {
      const filter = selectionToFilter(nextSelection);
      const params = new URLSearchParams();
      if (filter.clientId) params.set('clientId', filter.clientId);
      if (filter.domainId) params.set('domainId', filter.domainId);
      if (filter.mailboxId) params.set('mailboxId', filter.mailboxId);
      if (mode === 'admin') {
        if (executiveFilter) params.set('executiveId', executiveFilter);
        if (sequenceFilter) params.set('sequenceId', sequenceFilter);
        if (unreadFilter) params.set('unread', unreadFilter);
        if (classificationFilter) params.set('classification', classificationFilter);
        if (responseOutcomeFilter) params.set('responseOutcome', responseOutcomeFilter);
        if (dateFromFilter) params.set('dateFrom', new Date(dateFromFilter).toISOString());
        if (dateToFilter) params.set('dateTo', new Date(dateToFilter).toISOString());
      }
      const response = await fetch(`${basePath}?${params.toString()}`);
      if (response.ok) {
        setConversations(await response.json());
      }
    } finally {
      setLoadingList(false);
    }
  }

  function applyFilters(): void {
    void refreshList(selection);
  }

  /** Decrements this conversation's mailbox/domain/client unread counters in local tree state — mirrors the persisted server-side decrement so the left panel doesn't wait for a full reload. */

  function selectNode(nextSelection: TreeSelection): void {
    setSelection(nextSelection);
    void refreshList(nextSelection);
  }

  async function loadDetail(conversationId: string): Promise<void> {
    setSelectedId(conversationId);
    setShowPlainText(false);
    setLoadingDetail(true);
    setMobileShowDetail(true);
    setActionError(null);
    setOutcomeModalOpen(null);
    const params = new URLSearchParams();
    const filter = selectionToFilter(selection);
    if (filter.clientId) params.set('clientId', filter.clientId);
    if (filter.domainId) params.set('domainId', filter.domainId);
    if (filter.mailboxId) params.set('mailboxId', filter.mailboxId);
    params.set('conversationId', conversationId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    const wasUnread = conversations.find((c) => c.id === conversationId)?.isUnread ?? false;
    try {
      const response = await fetch(`${basePath}/${conversationId}`);
      if (response.ok) {
        const body: ConversationDetail = await response.json();
        setDetail(body);
        // Opening the conversation marks it read server-side — reflect that immediately in the conversation list without waiting for a full reload.
        setConversations((current) => current.map((c) => (c.id === conversationId ? { ...c, isUnread: false } : c)));
        // The account tree's own unread counters are NOT decremented here —
        // `router.replace` above (with the new conversationId search param)
        // already triggers Next.js to re-run this page's Server Component,
        // which re-fetches `initialDetail` (marking read) and then a fresh
        // `tree` reflecting the already-updated count (see the `useEffect`
        // syncing `treeState` from the `tree` prop). Decrementing it AGAIN
        // here would double-count, since both paths mark the same
        // conversation read.
        if (wasUnread) {
          // Lets the notification bell (a separate component/poll cycle)
          // recalculate its own count immediately instead of waiting up to
          // 20s for its next scheduled poll.
          window.dispatchEvent(new CustomEvent('mr-outreach:conversation-read', { detail: { conversationId } }));
        }
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  async function addNote(): Promise<void> {
    if (!detail || !newNote.trim()) return;
    setSavingNote(true);
    try {
      const response = await fetch(`${basePath}/${detail.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newNote.trim() }),
      });
      if (response.ok) {
        const note = await response.json();
        setDetail((current) => (current ? { ...current, notes: [...current.notes, note] } : current));
        setNewNote('');
      }
    } finally {
      setSavingNote(false);
    }
  }

  async function toggleRead(): Promise<void> {
    if (!detail) return;
    // Re-fetching detail already marks it read server-side; for "marcar como no leído" there's
    // no dedicated endpoint (matching this phase's minimal read-state model — only "opening marks
    // read" is asked for), so we only support flipping unread -> read here.
    if (detail.isUnread) {
      await loadDetail(detail.id);
    }
  }

  async function runResponseOutcome(
    action: 'not-interested' | 'do-not-contact' | 'interested' | 'refer',
    body?: Record<string, unknown>,
  ): Promise<void> {
    if (!detail) return;
    setActionError(null);
    setActionPending(true);
    try {
      const response = await fetch(`${basePath}/${detail.id}/response-outcome/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError(result.message ?? result.error ?? 'No se pudo completar la acción.');
        return;
      }
      if (result.conversation) {
        setDetail((current) => (current ? { ...current, ...result.conversation } : current));
        setConversations((current) =>
          current.map((c) => (c.id === detail.id ? { ...c, ...result.conversation } : c)),
        );
      }
      setOutcomeModalOpen(null);
    } catch {
      setActionError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setActionPending(false);
    }
  }

  function confirmOutcome(payload: ResponseOutcomeConfirmPayload): void {
    if (!outcomeModalOpen) return;
    void runResponseOutcome(OUTCOME_TO_ACTION[outcomeModalOpen], { ...payload });
  }

  function backToList(): void {
    setMobileShowDetail(false);
  }

  const contactStatus = detail?.contactStatus ?? null;
  const canAct =
    mode === 'self' &&
    Boolean(contactStatus) &&
    !TERMINAL_CONTACT_STATUSES.includes(contactStatus as SequenceContactStatus);

  return (
    <div className="flex flex-col gap-3">
      {mode === 'admin' && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-900/5">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Ejecutivo
            <select
              value={executiveFilter}
              onChange={(event) => setExecutiveFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Todos</option>
              {executives.map((executive) => (
                <option key={executive.id} value={executive.id}>
                  {executive.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Secuencia
            <select
              value={sequenceFilter}
              onChange={(event) => setSequenceFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Todas</option>
              {sequences.map((sequence) => (
                <option key={sequence.id} value={sequence.id}>
                  {sequence.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Lectura
            <select
              value={unreadFilter}
              onChange={(event) => setUnreadFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Todas</option>
              <option value="true">No leídas</option>
              <option value="false">Leídas</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Clasificación
            <select
              value={classificationFilter}
              onChange={(event) => setClassificationFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Todas</option>
              {CLASSIFICATION_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {CLASSIFICATION_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Resultado de la conversación
            <select
              value={responseOutcomeFilter}
              onChange={(event) => setResponseOutcomeFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Todos</option>
              <option value="UNCLASSIFIED">Sin clasificar</option>
              {(Object.keys(RESPONSE_OUTCOME_LABEL) as ResponseOutcome[]).map((value) => (
                <option key={value} value={value}>
                  {RESPONSE_OUTCOME_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Desde
            <input
              type="date"
              value={dateFromFilter}
              onChange={(event) => setDateFromFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Hasta
            <input
              type="date"
              value={dateToFilter}
              onChange={(event) => setDateToFilter(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            Filtrar
          </button>
        </div>
      )}

      <div
        className="flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5"
        style={{ height: '78vh' }}
      >
      {/* Columna 1 — Cliente → Dominio → Cuenta */}
      <div className="hidden w-[260px] shrink-0 flex-col overflow-hidden border-slate-200 md:flex md:border-r">
        <div className="border-b border-slate-100 px-3 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cuentas de correos</h2>
        </div>
        <AccountsTree tree={treeState} selection={selection} onSelect={selectNode} />
      </div>

      {/* Columna 2 — Conversaciones */}
      <div
        className={`${mobileShowDetail ? 'hidden' : 'flex'} w-full shrink-0 flex-col overflow-y-auto border-slate-200 md:flex md:w-[340px] md:border-r`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Conversaciones</h2>
          {loadingList && <span className="text-xs text-slate-400">Cargando…</span>}
        </div>
        {conversations.length === 0 && !loadingList && (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            {!selection
              ? 'Selecciona un cliente, dominio o cuenta de correo.'
              : selection.level !== 'mailbox'
                ? 'Selecciona una cuenta de correo para ver sus conversaciones.'
                : 'No hay conversaciones para esta cuenta.'}
          </p>
        )}
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            type="button"
            onClick={() => void loadDetail(conversation.id)}
            aria-current={conversation.id === selectedId}
            className={`flex w-full flex-col gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-0 ${
              conversation.id === selectedId ? 'bg-brand-50 ring-1 ring-inset ring-brand-300' : 'hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                {conversation.isUnread && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                )}
                <span className={`truncate text-sm ${conversation.isUnread ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                  {conversation.contactName ?? conversation.contactEmail}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-slate-400">{relativeDate(conversation.lastMessageAt)}</span>
            </div>
            <span className="truncate text-sm text-slate-600">{conversation.subject}</span>
            <span className="truncate text-[11px] text-slate-400">{conversation.companyName ?? 'Empresa sin identificar'}</span>
            <ResponseOutcomeBadge outcome={conversation.responseOutcome} />
            {mode === 'admin' && (
              <span className="truncate text-[11px] text-slate-400">
                Ejecutivo: {conversation.assignedExecutiveName ?? 'Sin asignar'}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Columna 3 — Detalle */}
      <div className={`${mobileShowDetail ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col overflow-y-auto md:flex`}>
        {!detail && !loadingDetail && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="text-sm font-medium text-slate-600">Selecciona una conversación</p>
            <p className="text-xs text-slate-400">El hilo aparecerá en este panel.</p>
          </div>
        )}
        {loadingDetail && <p className="p-6 text-center text-sm text-slate-500">Cargando…</p>}
        {detail && !loadingDetail && (
          <div className="flex flex-col gap-3 p-4">
            <button
              type="button"
              onClick={backToList}
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-brand-700 hover:underline md:hidden"
            >
              ← Volver a conversaciones
            </button>

            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{detail.subject}</h3>
                  <ResponseOutcomeBadge outcome={detail.responseOutcome} />
                </div>
                <p className="text-xs text-slate-500">
                  {detail.contactName ?? detail.contactEmail} · {detail.contactEmail}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
                  <span>Secuencia: {detail.sequenceName ?? 'No asociada'}</span>
                  <span>
                    Step:{' '}
                    {detail.originatingStepName
                      ? `${detail.originatingStepName} (Step ${detail.originatingStepPosition})`
                      : '—'}
                  </span>
                  <span>Prospecto: {detail.companyName ?? 'Sin empresa asociada'}</span>
                  <span>Contacto: {detail.contactName ?? detail.contactEmail}</span>
                  {mode === 'admin' && (
                    <span>Ejecutivo responsable: {detail.assignedExecutiveName ?? 'Sin asignar'}</span>
                  )}
                </div>
              </div>
              <ThreadActionsMenu
                detail={detail}
                showPlainText={showPlainText}
                onTogglePlainText={() => setShowPlainText((v) => !v)}
                onToggleRead={() => void toggleRead()}
              />
            </div>

            {mode === 'self' && (
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resultado de la respuesta</h4>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canAct || actionPending}
                  onClick={() => setOutcomeModalOpen('NOT_INTERESTED')}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  No interesado
                </button>
                <button
                  type="button"
                  disabled={!canAct || actionPending}
                  onClick={() => setOutcomeModalOpen('DO_NOT_CONTACT')}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  No contactar
                </button>
                <button
                  type="button"
                  disabled={!canAct || actionPending}
                  onClick={() => setOutcomeModalOpen('INTERESTED')}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Interesado
                </button>
                <button
                  type="button"
                  disabled={!canAct || actionPending}
                  onClick={() => setOutcomeModalOpen('REFERRED')}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Deriva
                </button>
              </div>

              <ul className="flex flex-col gap-1 text-[11px] text-slate-500">
                <li><span className="font-medium text-slate-600">No interesado:</span> la empresa indica que no tiene interés. Se detienen los próximos envíos para todos sus contactos.</li>
                <li><span className="font-medium text-slate-600">No contactar:</span> el contacto solicita no recibir más correos. Se detienen los envíos solamente para ese contacto.</li>
                <li><span className="font-medium text-slate-600">Interesado:</span> la empresa muestra interés. Se detiene la secuencia completa para continuar la gestión comercial.</li>
                <li><span className="font-medium text-slate-600">Deriva:</span> el contacto dirige la gestión a otra persona de la empresa. Se retira al contacto original y se permite incorporar al nuevo contacto.</li>
              </ul>
            </div>
            )}

            {mode === 'self' && (
              <ResponseOutcomeModal
                outcome={outcomeModalOpen}
                contactLabel={detail.contactName ?? detail.contactEmail}
                pending={actionPending}
                error={actionError}
                onCancel={() => {
                  setOutcomeModalOpen(null);
                  setActionError(null);
                }}
                onConfirm={confirmOutcome}
              />
            )}

            <div className="flex flex-col gap-2">
              {detail.messages.map((message) => (
                <div
                  key={message.id}
                  id={`message-${message.id}`}
                  className={`flex flex-col gap-1 rounded-lg border p-3 text-sm transition-shadow ${
                    message.direction === 'OUTBOUND' ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
                  } ${highlightedMessageId === message.id ? 'ring-2 ring-brand-400' : ''}`}
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      <span className="font-medium text-slate-700">
                        {message.direction === 'OUTBOUND' ? 'Tú' : (message.senderName ?? message.senderEmail)}
                      </span>{' '}
                      → {message.recipients.join(', ')}
                    </span>
                    <span className="font-mono">{new Date(message.receivedAt ?? message.sentAt ?? '').toLocaleString('es-CL')}</span>
                  </div>
                  {showPlainText ? (
                    <pre className="whitespace-pre-wrap font-sans text-slate-800">{message.plainTextBody}</pre>
                  ) : (
                    <div
                      className="prose-signature text-slate-800"
                      dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(message.htmlBody) }}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notas internas</h4>
              {detail.notes.length === 0 && <p className="text-xs text-slate-400">Todavía no hay notas en esta conversación.</p>}
              {detail.notes.map((note) => (
                <div key={note.id} className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                  <p>{note.content}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {note.authorName} · {new Date(note.createdAt).toLocaleString('es-CL')}
                  </p>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newNote}
                  onChange={(event) => setNewNote(event.target.value)}
                  placeholder="Agregar una nota interna…"
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                />
                <button
                  type="button"
                  onClick={() => void addNote()}
                  disabled={savingNote || !newNote.trim()}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                >
                  {savingNote ? 'Guardando…' : 'Agregar nota'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
