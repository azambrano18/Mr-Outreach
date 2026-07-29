'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * §5 — the whole row opens the account's detail; "Ver detalles" was removed
 * entirely. Interactive controls nested inside a row (selects, checkboxes,
 * buttons) must call `event.stopPropagation()` themselves so clicking them
 * never also triggers this row-level navigation.
 */
export function MailboxRow({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      tabIndex={0}
      role="link"
      aria-label={`Abrir detalle de ${label}`}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') router.push(href);
      }}
      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
    >
      {children}
    </tr>
  );
}
