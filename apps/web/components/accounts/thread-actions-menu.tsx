'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { ConversationDetail } from '@outreach/shared-types';

/**
 * §5 — Responder/Responder a todos/Archivar are gone with no trace (not
 * even disabled). The prospect-scoped sequence controls that used to live
 * here (Pausar/Reanudar/Finalizar/No contactar) moved to the "Resultado de
 * la respuesta" bar in `AccountsWorkspace`, since they're now framed as
 * business outcomes of the reply (No interesado/No contactar/Interesado/
 * Deriva) rather than generic prospect actions — this menu is back to just
 * view/tracking controls.
 */
export function ThreadActionsMenu({
  detail,
  showPlainText,
  onTogglePlainText,
  onToggleRead,
}: {
  detail: ConversationDetail;
  showPlainText: boolean;
  onTogglePlainText: () => void;
  onToggleRead: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Más acciones"
        aria-haspopup="true"
        aria-expanded={open}
        className="rounded-md p-1.5 text-slate-500 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onToggleRead();
            }}
            className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            {detail.isUnread ? 'Marcar como leído' : 'Marcar como no leído'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onTogglePlainText();
            }}
            className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            {showPlainText ? 'Ver HTML' : 'Ver texto plano'}
          </button>
        </div>
      )}
    </div>
  );
}
