'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import type { ConversationSummary } from '@outreach/shared-types';

const POLL_INTERVAL_MS = 20_000;
const SEEN_KEY = 'notification-bell-seen';

function loadSeenIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<string>): void {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage unavailable — badge just won't persist across reloads.
  }
}

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / (60 * 1000));
  if (minutes < 1) return 'hace instantes';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * §4 of the executive "Cuentas de correos" spec. There is no push/websocket
 * infrastructure anywhere in this codebase (confirmed before building this)
 * — "actualización automática" here means polling, not true server push;
 * disclosed rather than faked as real-time.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSeenIds(loadSeenIds());
  }, []);

  const unseenCount = items.filter((item) => !seenIds.has(item.id)).length;

  const load = useCallback(async () => {
    const response = await fetch('/api/me/conversations?unread=true');
    if (response.ok) {
      setItems(await response.json());
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // Recalculates the badge the instant a conversation is marked read from
  // anywhere else in the app (e.g. the conversation list, not the bell
  // itself) — otherwise the count would only catch up on the next poll.
  useEffect(() => {
    function handleConversationRead(event: Event): void {
      const conversationId = (event as CustomEvent<{ conversationId: string }>).detail?.conversationId;
      if (conversationId) {
        setItems((current) => current.filter((item) => item.id !== conversationId));
      } else {
        void load();
      }
    }
    window.addEventListener('mr-outreach:conversation-read', handleConversationRead);
    return () => window.removeEventListener('mr-outreach:conversation-read', handleConversationRead);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function openNotification(conversation: ConversationSummary): void {
    setOpen(false);
    // Remove it immediately rather than waiting for the destination page's
    // read-marking + a refetch — the alert must disappear the instant the
    // user acts on it, not ~1s later.
    setItems((current) => current.filter((item) => item.id !== conversation.id));
    const params = new URLSearchParams();
    if (conversation.clientId) params.set('clientId', conversation.clientId);
    if (conversation.domainId) params.set('domainId', conversation.domainId);
    params.set('mailboxId', conversation.mailboxId);
    params.set('conversationId', conversation.id);
    router.push(`/dashboard/mailboxes/mine?${params.toString()}`);
    // Refetch shortly after anyway, to reconcile with the server in case
    // something else changed concurrently.
    setTimeout(() => void load(), 800);
  }

  function toggleOpen(): void {
    setOpen((value) => {
      const next = !value;
      if (next) {
        // Opening the bell clears the numeric alert for everything currently
        // listed — distinct from "read", which only happens per-conversation
        // when it's actually opened. A genuinely new reply (not in this set)
        // makes the badge reappear on the next poll.
        const updated = new Set(seenIds);
        for (const item of items) updated.add(item.id);
        setSeenIds(updated);
        saveSeenIds(updated);
      }
      return next;
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Notificaciones"
        aria-haspopup="true"
        aria-expanded={open}
        className="relative inline-flex rounded-md p-2 text-slate-500 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <Bell className="h-5 w-5" />
        {unseenCount > 0 && (
          <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unseenCount > 99 ? '99+' : unseenCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-96 max-w-[90vw] rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Respuestas no leídas {items.length > 0 && `(${items.length})`}
            </h2>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-400">Sin respuestas pendientes.</p>
            )}
            {items.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                role="menuitem"
                onClick={() => openNotification(conversation)}
                className="flex w-full flex-col gap-0.5 border-b border-slate-50 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${!seenIds.has(conversation.id) ? 'bg-brand-600' : 'bg-transparent'}`}
                    />
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {conversation.companyName ?? 'Empresa sin identificar'}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">
                    {relativeDate(conversation.lastMessageAt as unknown as string)}
                  </span>
                </div>
                <span className="truncate text-xs text-slate-700">
                  {conversation.contactName ?? conversation.contactEmail}
                  {conversation.contactName ? ` · ${conversation.contactEmail}` : ''}
                </span>
                <span className="truncate text-xs text-slate-600">{conversation.subject}</span>
                <span className="truncate text-[11px] text-slate-400">
                  {conversation.clientName ?? 'Cliente pendiente'} · {conversation.domainName ?? '—'} ·{' '}
                  {conversation.mailboxEmail}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
