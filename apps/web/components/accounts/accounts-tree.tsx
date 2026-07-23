'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Mail } from 'lucide-react';
import type { ConversationTreeClientNode } from '@outreach/shared-types';

const EXPANDED_KEY = 'accounts-tree-expanded';

export type TreeSelection =
  | { level: 'client'; clientId: string }
  | { level: 'domain'; clientId: string; domainId: string }
  | { level: 'mailbox'; clientId: string; domainId: string; mailboxId: string };

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** §2-3 — Cliente → Dominio → Cuenta cascading tree, expand-state remembered for the session. */
export function AccountsTree({
  tree,
  selection,
  onSelect,
}: {
  tree: ConversationTreeClientNode[];
  selection: TreeSelection | null;
  onSelect: (selection: TreeSelection) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const lastEmittedSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(EXPANDED_KEY);
      if (stored) setExpanded(new Set(JSON.parse(stored)));
    } catch {
      // Corrupt/blocked storage — start collapsed, not worth surfacing as an error.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(expanded)));
  }, [expanded, hydrated]);

  function selectionKey(s: TreeSelection | null): string {
    if (!s) return '';
    if (s.level === 'client') return `client:${s.clientId}`;
    if (s.level === 'domain') return `domain:${s.clientId}:${s.domainId}`;
    return `mailbox:${s.clientId}:${s.domainId}:${s.mailboxId}`;
  }

  // Deep-links (e.g. the notification bell opening a specific mailbox's conversation) must always
  // show their client/domain expanded, even on a first visit with nothing in sessionStorage yet —
  // otherwise the selected mailbox row never renders (its parent branches stay collapsed) and the
  // "expandir el cliente/dominio" step of that flow silently does nothing. But a selection change
  // that WE just emitted ourselves (a plain click on an already-expanded client/domain, meant to
  // collapse it) must not be treated as a deep link — otherwise every collapse click immediately
  // re-expands itself, since clicking always calls onSelect too.
  useEffect(() => {
    if (!selection) return;
    const key = selectionKey(selection);
    if (lastEmittedSelectionRef.current === key) {
      lastEmittedSelectionRef.current = null;
      return;
    }
    setExpanded((current) => {
      const next = new Set(current);
      next.add(`client:${selection.clientId}`);
      if (selection.level === 'domain' || selection.level === 'mailbox') {
        next.add(`domain:${selection.domainId}`);
      }
      return next;
    });
  }, [selection]);

  function toggle(key: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function emitSelect(next: TreeSelection): void {
    lastEmittedSelectionRef.current = selectionKey(next);
    onSelect(next);
  }

  function isClientSelected(id: string): boolean {
    return selection?.level === 'client' && selection.clientId === id;
  }
  function isDomainSelected(id: string): boolean {
    return selection?.level === 'domain' && selection.domainId === id;
  }
  function isMailboxSelected(id: string): boolean {
    return selection?.level === 'mailbox' && selection.mailboxId === id;
  }

  return (
    <div className="flex flex-col overflow-y-auto py-1 text-sm">
      {tree.map((client) => {
        const clientKey = `client:${client.id}`;
        const clientExpanded = expanded.has(clientKey);
        return (
          <div key={client.id}>
            <button
              type="button"
              onClick={() => {
                toggle(clientKey);
                emitSelect({ level: 'client', clientId: client.id });
              }}
              aria-current={isClientSelected(client.id)}
              className={`flex w-full items-center gap-1.5 px-2 py-2 text-left font-medium transition-colors ${
                isClientSelected(client.id) ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50'
              }`}
            >
              {clientExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              )}
              <span className="truncate">{client.name}</span>
              <UnreadBadge count={client.unreadCount} />
            </button>

            {clientExpanded &&
              client.domains.map((domain) => {
                const domainKey = `domain:${domain.id}`;
                const domainExpanded = expanded.has(domainKey);
                return (
                  <div key={domain.id}>
                    <button
                      type="button"
                      onClick={() => {
                        toggle(domainKey);
                        emitSelect({ level: 'domain', clientId: client.id, domainId: domain.id });
                      }}
                      aria-current={isDomainSelected(domain.id)}
                      className={`flex w-full items-center gap-1.5 py-1.5 pl-6 pr-2 text-left text-[13px] transition-colors ${
                        isDomainSelected(domain.id) ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50'
                      }`}
                    >
                      {domainExpanded ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                      )}
                      <span className="truncate">{domain.domainName}</span>
                      <UnreadBadge count={domain.unreadCount} />
                    </button>

                    {domainExpanded &&
                      domain.mailboxes.map((mailbox) => (
                        <button
                          key={mailbox.id}
                          type="button"
                          onClick={() =>
                            emitSelect({
                              level: 'mailbox',
                              clientId: client.id,
                              domainId: domain.id,
                              mailboxId: mailbox.id,
                            })
                          }
                          aria-current={isMailboxSelected(mailbox.id)}
                          className={`flex w-full items-center gap-1.5 py-1.5 pl-10 pr-2 text-left text-[13px] transition-colors ${
                            isMailboxSelected(mailbox.id)
                              ? 'bg-brand-50 font-medium text-brand-700'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <Mail className="h-3 w-3 shrink-0 text-slate-400" />
                          <span className="truncate">{mailbox.email}</span>
                          <UnreadBadge count={mailbox.unreadCount} />
                        </button>
                      ))}
                  </div>
                );
              })}
          </div>
        );
      })}
      {tree.length === 0 && (
        <p className="px-3 py-6 text-center text-sm text-slate-400">
          Todavía no tienes clientes con cuentas de correo asignadas.
        </p>
      )}
    </div>
  );
}
