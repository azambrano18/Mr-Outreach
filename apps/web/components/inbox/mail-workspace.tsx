'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AssignedMailboxSummary,
  InboxMessageSummary,
  MailboxAdminStatus,
  MailboxConnectionStatus,
  MailboxInboxSummary,
} from '@outreach/shared-types';
import { STATUS_MESSAGE, ThreadListItem, ThreadReadingPanel } from './inbox-view';

const ADMIN_STATUS_LABEL: Record<MailboxAdminStatus, string> = {
  ACTIVE: 'Operativa',
  INACTIVE: 'Inactiva',
  ARCHIVED: 'Archivada',
};

const CONNECTION_LABEL: Record<MailboxConnectionStatus, string> = {
  NOT_TESTED: 'Sin probar',
  TESTING: 'Probando…',
  CONNECTED: 'Conectada',
  PARTIALLY_CONNECTED: 'Conexión parcial',
  CONNECTION_ERROR: 'Error de conexión',
  ENGINE_UNAVAILABLE: 'Motor no disponible',
};

const CONNECTION_DOT: Record<MailboxConnectionStatus, string> = {
  NOT_TESTED: 'bg-slate-300',
  TESTING: 'bg-amber-400',
  CONNECTED: 'bg-emerald-500',
  PARTIALLY_CONNECTED: 'bg-amber-400',
  CONNECTION_ERROR: 'bg-red-500',
  ENGINE_UNAVAILABLE: 'bg-red-500',
};

type MobileStage = 'accounts' | 'messages' | 'thread';

function AccountCard({
  mailbox,
  active,
  onSelect,
}: {
  mailbox: AssignedMailboxSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={`flex w-full flex-col gap-0.5 border-l-2 px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${
        active ? 'border-brand-600 bg-brand-50' : 'border-transparent hover:bg-slate-50'
      }`}
    >
      <span className="truncate text-sm font-medium text-slate-900">{mailbox.name}</span>
      <span className="truncate text-xs text-slate-500">{mailbox.email}</span>
      <span className="flex items-center gap-1.5 text-xs text-slate-500">
        <span>{ADMIN_STATUS_LABEL[mailbox.status]}</span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[mailbox.connectionStatus]}`}
          />
          {CONNECTION_LABEL[mailbox.connectionStatus]}
        </span>
      </span>
    </button>
  );
}

export function MailWorkspace({
  mailboxes,
  initialMailboxId,
  initialThreadId,
  initialInbox,
}: {
  mailboxes: AssignedMailboxSummary[];
  initialMailboxId: string | null;
  initialThreadId: string | null;
  initialInbox: MailboxInboxSummary | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(initialMailboxId);
  const [inbox, setInbox] = useState<MailboxInboxSummary | null>(initialInbox);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [inboxLoadError, setInboxLoadError] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<InboxMessageSummary[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [showPlainText, setShowPlainText] = useState(false);
  const [mobileStage, setMobileStage] = useState<MobileStage>(
    initialThreadId ? 'thread' : initialMailboxId ? 'messages' : 'accounts',
  );

  useEffect(() => {
    if (initialMailboxId && initialThreadId) {
      void selectThread(initialThreadId, { updateUrl: false, markRead: false });
    }
    // Only on mount — later selections go through selectThread directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateUrl(next: { mailboxId?: string | null; threadId?: string | null }): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next.mailboxId !== undefined) {
      if (next.mailboxId) params.set('mailboxId', next.mailboxId);
      else params.delete('mailboxId');
    }
    if (next.threadId !== undefined) {
      if (next.threadId) params.set('threadId', next.threadId);
      else params.delete('threadId');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function loadInbox(mailboxId: string): Promise<void> {
    setLoadingInbox(true);
    setInboxLoadError(false);
    try {
      const response = await fetch(`/api/me/mailboxes/${mailboxId}/inbox`);
      if (!response.ok) {
        setInboxLoadError(true);
        setInbox(null);
        return;
      }
      setInbox(await response.json());
    } catch {
      setInboxLoadError(true);
      setInbox(null);
    } finally {
      setLoadingInbox(false);
    }
  }

  async function selectMailbox(mailboxId: string): Promise<void> {
    if (mailboxId === selectedMailboxId) {
      setMobileStage('messages');
      return;
    }
    setSelectedMailboxId(mailboxId);
    setSelectedThreadId(null);
    setMessages([]);
    setThreadError(null);
    setMobileStage('messages');
    updateUrl({ mailboxId, threadId: null });
    await loadInbox(mailboxId);
  }

  async function selectThread(
    threadId: string,
    options: { updateUrl?: boolean; markRead?: boolean } = {},
  ): Promise<void> {
    const { updateUrl: shouldUpdateUrl = true, markRead = true } = options;
    const mailboxId = selectedMailboxId ?? initialMailboxId;
    if (!mailboxId) return;

    setSelectedThreadId(threadId);
    setShowPlainText(false);
    setThreadError(null);
    setLoadingThread(true);
    setMobileStage('thread');

    if (shouldUpdateUrl) {
      updateUrl({ threadId });
    }

    try {
      const response = await fetch(`/api/me/mailboxes/${mailboxId}/inbox/threads/${threadId}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.status !== 'OK') {
        setMessages([]);
        setThreadError(body.error ?? 'No se pudo cargar el hilo.');
        return;
      }
      setMessages(body.messages);

      if (markRead) {
        const thread = inbox?.threads.find((t) => t.id === threadId);
        if (thread && thread.unreadCount > 0) {
          void setThreadRead(threadId, false);
        }
      }
    } finally {
      setLoadingThread(false);
    }
  }

  async function setThreadRead(threadId: string, isUnread: boolean): Promise<void> {
    if (!selectedMailboxId) return;
    setInbox((current) =>
      current
        ? {
            ...current,
            threads: current.threads.map((thread) =>
              thread.id === threadId
                ? { ...thread, unreadCount: isUnread ? Math.max(thread.unreadCount, 1) : 0 }
                : thread,
            ),
          }
        : current,
    );
    await fetch(`/api/me/mailboxes/${selectedMailboxId}/inbox/threads/${threadId}/read-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isUnread }),
    }).catch(() => {});
  }

  function backToAccounts(): void {
    setMobileStage('accounts');
  }

  function backToMessages(): void {
    setSelectedThreadId(null);
    setMessages([]);
    setThreadError(null);
    updateUrl({ threadId: null });
    setMobileStage('messages');
  }

  const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? null;
  const statusMessage = inbox ? STATUS_MESSAGE[inbox.status] : null;
  const selectedThread = inbox?.threads.find((thread) => thread.id === selectedThreadId) ?? null;
  const isUnread = (selectedThread?.unreadCount ?? 0) > 0;
  const hasConnectionError = inboxLoadError || Boolean(statusMessage);

  return (
    <div
      className="flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5"
      style={{ height: '75vh' }}
    >
      {/* Columna 1 — Cuentas */}
      <div
        role="listbox"
        aria-label="Cuentas de correo asignadas"
        className={`${mobileStage === 'accounts' ? 'flex' : 'hidden'} md:flex w-full shrink-0 flex-col overflow-y-auto border-slate-200 md:w-[240px] md:border-r lg:w-[260px]`}
      >
        <div className="border-b border-slate-100 px-3 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cuentas</h2>
        </div>
        {mailboxes.map((mailbox) => (
          <AccountCard
            key={mailbox.id}
            mailbox={mailbox}
            active={mailbox.id === selectedMailboxId}
            onSelect={() => void selectMailbox(mailbox.id)}
          />
        ))}
        {mailboxes.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            Todavía no tienes cuentas de correo asignadas.
          </p>
        )}
      </div>

      {/* Columna 2 — Mensajes */}
      <div
        className={`${mobileStage === 'messages' ? 'flex' : 'hidden'} ${
          selectedThreadId ? 'md:hidden' : 'md:flex'
        } lg:flex w-full shrink-0 flex-col overflow-hidden border-slate-200 md:w-[360px] md:border-r lg:w-[380px]`}
      >
        {selectedMailbox ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={backToAccounts}
                  className="mb-0.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline md:hidden"
                >
                  ← Cuentas
                </button>
                <h2 className="truncate text-sm font-semibold text-slate-900">
                  {selectedMailbox.name}
                </h2>
              </div>
              <Link
                href={`/dashboard/mailboxes/mine/${selectedMailbox.id}/settings`}
                aria-label="Configurar cuenta de correo"
                title="Configurar cuenta"
                className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-300 p-1.5 text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingInbox && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">Cargando…</p>
              )}

              {!loadingInbox && hasConnectionError && (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-slate-600">
                    No fue posible cargar los mensajes
                  </p>
                  <p className="text-xs text-slate-400">
                    Revisa el estado de conexión de esta cuenta.
                  </p>
                  <Link
                    href={`/dashboard/mailboxes/mine/${selectedMailbox.id}/settings?tab=connection`}
                    className="mt-1 text-xs font-medium text-brand-700 hover:underline"
                  >
                    Revisar configuración
                  </Link>
                </div>
              )}

              {!loadingInbox && !hasConnectionError && inbox && inbox.threads.length === 0 && (
                <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-slate-600">No hay mensajes</p>
                  <p className="text-xs text-slate-400">
                    Esta cuenta todavía no tiene mensajes sincronizados.
                  </p>
                </div>
              )}

              {!loadingInbox &&
                !hasConnectionError &&
                inbox?.threads.map((thread) => (
                  <ThreadListItem
                    key={thread.id}
                    thread={thread}
                    active={thread.id === selectedThreadId}
                    onSelect={() => void selectThread(thread.id)}
                  />
                ))}
            </div>

            {inbox && (
              <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
                {inbox.threads.length} conversaciones · datos de demostración (sin sincronización
                IMAP real todavía)
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="text-sm font-medium text-slate-600">Selecciona una cuenta</p>
            <p className="text-xs text-slate-400">
              Elige una cuenta de correo para revisar sus mensajes.
            </p>
          </div>
        )}
      </div>

      {/* Columna 3 — Panel de lectura */}
      <div
        className={`${mobileStage === 'thread' ? 'flex' : 'hidden'} ${
          selectedThreadId ? 'md:flex' : 'md:hidden'
        } lg:flex min-w-0 flex-1 flex-col overflow-y-auto`}
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
          onBack={backToMessages}
          backLabel="← Volver a mensajes"
          backClassName="lg:hidden"
          emptyDescription="El hilo del mensaje aparecerá en este panel."
          mailboxEmail={selectedMailbox?.email}
        />
      </div>
    </div>
  );
}
