'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

/**
 * Shared table primitives, standardized on the pattern first established in
 * apps/dashboard/executives (ExecutiveRow): white container, slate border,
 * uppercase header, px-4 py-3 cells, brand-tinted hover, and a real <Link>
 * on the entity name as the primary way to open its detail page — no
 * separate "Ver"/"Ver detalle" column. Reuse these instead of re-styling a
 * new table per screen.
 */

export function DataTableContainer({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
      {children}
    </div>
  );
}

export function DataTable({ children }: { children: ReactNode }) {
  return <table className="w-full text-left text-sm">{children}</table>;
}

export function DataTableHeader({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
      <tr>{children}</tr>
    </thead>
  );
}

export function DataTableHeaderCell({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <th className={`px-4 py-3 ${className ?? ''}`}>{children}</th>;
}

/**
 * A whole table row that navigates to `href` on click, Enter, or Space —
 * only use this when the row has no nested interactive controls that would
 * conflict with row-level navigation, or when every such control already
 * calls `event.stopPropagation()` on its own click/keydown handlers.
 */
export function ClickableTableRow({
  href,
  ariaLabel,
  children,
  className,
}: {
  href: string;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>): void {
    if (event.key === 'Enter') {
      router.push(href);
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      router.push(href);
    }
  }

  return (
    <tr
      onClick={() => router.push(href)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="link"
      aria-label={ariaLabel}
      className={`cursor-pointer border-b border-slate-100 outline-none transition-colors last:border-0 hover:bg-brand-50/50 focus-visible:bg-brand-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${className ?? ''}`}
    >
      {children}
    </tr>
  );
}

/**
 * The entity name/label rendered as the primary link to its detail page.
 * Always call event.stopPropagation() so a click doesn't also bubble into
 * a parent ClickableTableRow's onClick and double-navigate.
 */
export function PrimaryItemLink({ href, children }: { href: string; children: ReactNode }) {
  function stopPropagation(event: MouseEvent<HTMLAnchorElement>): void {
    event.stopPropagation();
  }

  return (
    <Link
      href={href}
      onClick={stopPropagation}
      className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
    >
      {children}
    </Link>
  );
}

export function EmptyTableState({ colSpan, message = 'Sin resultados.' }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6 text-center text-slate-500">
        {message}
      </td>
    </tr>
  );
}
