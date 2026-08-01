'use client';

import { useMemo, useRef, useState } from 'react';
import type { UserSummary } from '@outreach/shared-types';
import { useOnClickOutside } from '../../lib/use-on-click-outside';

/**
 * Searchable multi-select combobox, visually coherent with the plain
 * `<select>` used for the principal: a closed field showing chips + a
 * count, a dropdown with a search box and one checkbox per candidate when
 * open. Shared by both places an account has secondary executives assigned
 * — the "Vincular cuenta de correo" form and the linked-account detail
 * page's "Asignaciones" section — so they never drift into two different
 * interaction patterns again.
 */
export function SecondaryExecutivesSelect({
  candidates,
  selectedIds,
  onChange,
  disabled,
}: {
  candidates: UserSummary[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setOpen(false));

  const selected = candidates.filter((executive) => selectedIds.includes(executive.id));
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter(
      (executive) =>
        executive.name.toLowerCase().includes(query) || executive.email.toLowerCase().includes(query),
    );
  }, [candidates, search]);

  function toggle(executiveId: string): void {
    if (selectedIds.includes(executiveId)) {
      onChange(selectedIds.filter((id) => id !== executiveId));
    } else {
      onChange([...selectedIds, executiveId]);
    }
  }

  function remove(executiveId: string): void {
    onChange(selectedIds.filter((id) => id !== executiveId));
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[42px] w-full flex-wrap items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {selected.length === 0 ? (
          <span className="px-1 text-slate-400">Sin ejecutivos secundarios</span>
        ) : (
          selected.map((executive) => (
            <span
              key={executive.id}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
            >
              {executive.name}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Quitar a ${executive.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  remove(executive.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation();
                    event.preventDefault();
                    remove(executive.id);
                  }
                }}
                className="cursor-pointer text-brand-500 hover:text-brand-800"
              >
                ×
              </span>
            </span>
          ))
        )}
        <span className="ml-auto shrink-0 pl-2 text-xs text-slate-400">
          {selected.length > 0 ? `${selected.length} seleccionado${selected.length === 1 ? '' : 's'}` : ''}
        </span>
      </button>

      {open && !disabled && (
        <div className="absolute z-10 mt-11 flex w-full flex-col gap-1 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre o correo…"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-sm text-slate-400">Sin resultados.</p>
            ) : (
              filtered.map((executive) => (
                <label
                  key={executive.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(executive.id)}
                    onChange={() => toggle(executive.id)}
                  />
                  <span className="flex flex-col">
                    <span>{executive.name}</span>
                    <span className="text-xs text-slate-400">{executive.email}</span>
                  </span>
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="self-start px-2 text-xs font-medium text-slate-500 hover:text-red-600"
            >
              Limpiar selección
            </button>
          )}
        </div>
      )}
    </div>
  );
}
