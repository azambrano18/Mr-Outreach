'use client';

import { MoreVertical } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type {
  InboxMessageSummary,
  InboxThreadSummary,
  MailboxInboxSummary,
} from '@outreach/shared-types';
import { sanitizeRichTextHtml } from '../../lib/sanitize-html-client';

export const STATUS_MESSAGE: Record<MailboxInboxSummary['status'], string | null> = {
  OK: null,
  CONNECTION_ERROR: 'No se pudo conectar con el servidor de correo para leer la bandeja.',
  ENGINE_UNAVAILABLE: 'El motor de ejecución no está disponible en este momento.',
};

/** Actions the spec calls for but that have no real backend yet (no reply pipeline, no labels, no prospect/sequence linkage) — shown, not hidden, so the panel's structure is visible, but disabled rather than faked. */
const COMING_SOON_ACTIONS = [
  'Responder',
  'Responder a todos',
  'Archivar',
  'Agregar etiquetas',
  'Cambiar estado del prospecto',
  'Detener secuencia',
];

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours < 1) return 'hace instantes';
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}

export function ThreadListItem({
  thread,
  active,
  onSelect,
}: {
  thread: InboxThreadSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const participant = thread.participants[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={`flex w-full flex-col gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-0 ${
        active ? 'bg-brand-50 ring-1 ring-inset ring-brand-300' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`truncate text-sm ${thread.unreadCount > 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
        >
          {participant?.name ?? participant?.email ?? 'Desconocido'}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-slate-400">
          {relativeTime(thread.lastMessageAt)}
        </span>
      </div>
      <span
        className={`truncate text-sm ${thread.unreadCount > 0 ? 'font-medium text-slate-800' : 'text-slate-600'}`}
      >
        {thread.subject}
      </span>
      <span className="truncate text-xs text-slate-500">{thread.lastMessageSnippet}</span>
      {thread.unreadCount > 0 && (
        <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {thread.unreadCount} sin leer
        </span>
      )}
    </button>
  );
}

export function MessageBubble({
  message,
  showPlainText,
}: {
  message: InboxMessageSummary;
  showPlainText: boolean;
}) {
  const outbound = message.direction === 'OUTBOUND';
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border p-3 text-sm ${
        outbound ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          <span className="font-medium text-slate-700">
            {outbound ? 'Tú' : (message.from.name ?? message.from.email)}
          </span>{' '}
          → {message.to.map((to) => to.name ?? to.email).join(', ')}
        </span>
        <span className="font-mono">{new Date(message.receivedAt).toLocaleString('es-CL')}</span>
      </div>
      {showPlainText ? (
        <pre className="whitespace-pre-wrap font-sans text-slate-800">{message.bodyText}</pre>
      ) : (
        <div
          className="prose-signature text-slate-800"
          dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(message.bodyHtml) }}
        />
      )}
    </div>
  );
}

/**
 * The reading panel's actions, collapsed behind a three-dot menu — same
 * open/close/click-outside/Escape pattern as `UserMenu` (app/dashboard/
 * user-menu.tsx), the only other dropdown menu in this codebase.
 */
function ThreadActionsMenu({
  isUnread,
  onToggleRead,
  showPlainText,
  onTogglePlainText,
}: {
  isUnread: boolean;
  onToggleRead: () => void;
  showPlainText: boolean;
  onTogglePlainText: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function runAndClose(action: () => void): void {
    action();
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Más acciones"
        title="Más acciones"
        className="inline-flex items-center justify-center rounded-md border border-slate-300 p-1.5 text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700"
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-64 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onToggleRead)}
            className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            {isUnread ? 'Marcar como leído' : 'Marcar como no leído'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(onTogglePlainText)}
            className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            {showPlainText ? 'Ver HTML' : 'Ver texto plano'}
          </button>
          <div className="my-1 border-t border-slate-100" />
          {COMING_SOON_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              disabled
              title="Disponible en una fase futura"
              aria-disabled="true"
              className="w-full cursor-not-allowed rounded-md px-2.5 py-1.5 text-left text-sm text-slate-400"
            >
              {action}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The "hilo completo" reading panel — shared by `InboxView` (admin/mine
 * two-column inbox) and `MailWorkspace` (mine's Outlook-style three-column
 * inbox) so the message rendering, actions and empty state only exist once.
 */
export function ThreadReadingPanel({
  selectedThread,
  messages,
  loadingThread,
  threadError,
  showPlainText,
  onTogglePlainText,
  isUnread,
  onToggleRead,
  onBack,
  backLabel = '← Volver a la lista',
  backClassName = 'md:hidden',
  emptyDescription = 'El contenido del correo aparecerá en este panel.',
  mailboxEmail,
}: {
  selectedThread: InboxThreadSummary | null;
  messages: InboxMessageSummary[];
  loadingThread: boolean;
  threadError: string | null;
  showPlainText: boolean;
  onTogglePlainText: () => void;
  isUnread: boolean;
  onToggleRead: () => void;
  onBack?: () => void;
  backLabel?: string;
  /** Controls at which breakpoint the back button shows — mobile-only by default. */
  backClassName?: string;
  emptyDescription?: string;
  /** "Cuenta de correo" line in the meta block — omitted when the caller already shows it elsewhere (InboxView's own context bar). */
  mailboxEmail?: string;
}) {
  if (!selectedThread) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="text-sm font-medium text-slate-600">Selecciona una conversación</p>
        <p className="text-xs text-slate-400">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={`inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline ${backClassName}`}
          >
            {backLabel}
          </button>
        )}
        {/* `ml-auto` (not `justify-between` on the parent) so the menu still
            lands on the right even when the back button is `display:none`
            at this breakpoint — `justify-between` collapses to flex-start
            with a single visible flex child. */}
        <div className="ml-auto">
          <ThreadActionsMenu
            isUnread={isUnread}
            onToggleRead={onToggleRead}
            showPlainText={showPlainText}
            onTogglePlainText={onTogglePlainText}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1 border-b border-slate-100 pb-3">
        <h3 className="text-base font-semibold text-slate-900">{selectedThread.subject}</h3>
        <p className="text-xs text-slate-500">
          {selectedThread.participants.map((p) => p.name ?? p.email).join(', ')} ·{' '}
          {new Date(selectedThread.lastMessageAt).toLocaleString('es-CL')}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
          {mailboxEmail && <span>Cuenta de correo: {mailboxEmail}</span>}
          <span>Secuencia relacionada: no disponible en esta fase</span>
          <span>Step relacionado: no disponible en esta fase</span>
          <span>Prospecto relacionado: no disponible en esta fase</span>
          <span>Estado del prospecto: no disponible en esta fase</span>
          <span>CC: no disponible en esta fase</span>
          <span>Archivos adjuntos: no disponible en esta fase</span>
        </div>
      </div>

      {loadingThread && <p className="text-center text-sm text-slate-500">Cargando…</p>}
      {threadError && <p className="text-sm text-red-600">{threadError}</p>}
      {!loadingThread &&
        messages.map((message) => (
          <MessageBubble key={message.id} message={message} showPlainText={showPlainText} />
        ))}
    </div>
  );
}

export function InboxView({
  mailboxId,
  mailboxEmail,
  executiveLabel,
  initialInbox,
  mine = false,
}: {
  mailboxId: string;
  /** "Cuenta receptora" shown in the reading panel context bar. */
  mailboxEmail?: string;
  /** "Ejecutivo responsable" shown in the reading panel context bar. */
  executiveLabel?: string;
  initialInbox: MailboxInboxSummary;
  /** Executive self-service mode — hits /api/me/mailboxes instead of /api/mailboxes. */
  mine?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [inbox, setInbox] = useState(initialInbox);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    searchParams.get('thread') ?? initialInbox.threads[0]?.id ?? null,
  );
  const [messages, setMessages] = useState<InboxMessageSummary[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [showPlainText, setShowPlainText] = useState(false);
  const [mobileShowReading, setMobileShowReading] = useState(false);
  const mailboxesApi = mine ? '/api/me/mailboxes' : '/api/mailboxes';

  useEffect(() => {
    if (selectedThreadId) {
      void selectThread(selectedThreadId, { updateUrl: false, markRead: false });
    }
    // Only on mount — selecting a thread afterwards goes through selectThread directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshInbox(): Promise<void> {
    setRefreshing(true);
    try {
      const response = await fetch(`${mailboxesApi}/${mailboxId}/inbox`);
      if (response.ok) {
        setInbox(await response.json());
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function selectThread(
    threadId: string,
    options: { updateUrl?: boolean; markRead?: boolean } = {},
  ): Promise<void> {
    const { updateUrl = true, markRead = true } = options;
    setSelectedThreadId(threadId);
    setShowPlainText(false);
    setThreadError(null);
    setLoadingThread(true);
    setMobileShowReading(true);

    if (updateUrl) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('thread', threadId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }

    try {
      const response = await fetch(`${mailboxesApi}/${mailboxId}/inbox/threads/${threadId}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.status !== 'OK') {
        setMessages([]);
        setThreadError(body.error ?? 'No se pudo cargar el hilo.');
        return;
      }
      setMessages(body.messages);

      if (markRead) {
        const thread = inbox.threads.find((t) => t.id === threadId);
        if (thread && thread.unreadCount > 0) {
          void setThreadRead(threadId, false);
        }
      }
    } finally {
      setLoadingThread(false);
    }
  }

  async function setThreadRead(threadId: string, isUnread: boolean): Promise<void> {
    setInbox((current) => ({
      ...current,
      threads: current.threads.map((thread) =>
        thread.id === threadId
          ? { ...thread, unreadCount: isUnread ? Math.max(thread.unreadCount, 1) : 0 }
          : thread,
      ),
    }));
    await fetch(`${mailboxesApi}/${mailboxId}/inbox/threads/${threadId}/read-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isUnread }),
    }).catch(() => {});
  }

  function backToList(): void {
    setMobileShowReading(false);
  }

  const statusMessage = STATUS_MESSAGE[inbox.status];
  const selectedThread = inbox.threads.find((thread) => thread.id === selectedThreadId) ?? null;
  const isUnread = (selectedThread?.unreadCount ?? 0) > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {inbox.threads.length} conversaciones · datos de demostración (no hay sincronización IMAP
          real todavía)
        </span>
        <button
          type="button"
          onClick={refreshInbox}
          disabled={refreshing}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
        >
          {refreshing ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {(mailboxEmail || executiveLabel) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          {mailboxEmail && (
            <span>
              Cuenta receptora: <span className="font-medium text-slate-700">{mailboxEmail}</span>
            </span>
          )}
          {executiveLabel && (
            <span>
              Ejecutivo responsable:{' '}
              <span className="font-medium text-slate-700">{executiveLabel}</span>
            </span>
          )}
        </div>
      )}

      {statusMessage && <p className="text-sm text-red-600">{statusMessage}</p>}

      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5 md:grid-cols-[320px_1fr]">
        <div
          className={`max-h-[70vh] overflow-y-auto border-b border-slate-200 md:block md:border-b-0 md:border-r ${
            mobileShowReading ? 'hidden' : 'block'
          }`}
        >
          {inbox.threads.map((thread) => (
            <ThreadListItem
              key={thread.id}
              thread={thread}
              active={thread.id === selectedThreadId}
              onSelect={() => selectThread(thread.id)}
            />
          ))}
          {inbox.threads.length === 0 && !statusMessage && (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No hay conversaciones en esta bandeja.
            </p>
          )}
        </div>

        <div
          className={`flex max-h-[70vh] min-w-0 flex-col gap-3 overflow-y-auto md:flex ${
            mobileShowReading ? 'flex' : 'hidden'
          }`}
        >
          <ThreadReadingPanel
            selectedThread={selectedThread}
            messages={messages}
            loadingThread={loadingThread}
            threadError={threadError}
            showPlainText={showPlainText}
            onTogglePlainText={() => setShowPlainText((value) => !value)}
            isUnread={isUnread}
            onToggleRead={() => selectedThread && setThreadRead(selectedThread.id, !isUnread)}
            onBack={backToList}
          />
        </div>
      </div>
    </div>
  );
}
