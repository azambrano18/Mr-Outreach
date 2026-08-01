'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The one search box every listing uses (Cuentas de Correo, Ejecutivos,
 * Gestiones, Monitor de Gestiones) — a single implementation instead of
 * four near-identical ones. Debounces onChange so typing doesn't re-filter
 * (or re-request) on every keystroke; typing Enter flushes immediately.
 */
export function EntitySearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  debounceMs = 250,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  debounceMs?: number;
  loading?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stay in sync if the parent resets `value` (e.g. a "clear" action elsewhere).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function scheduleChange(next: string): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), debounceMs);
  }

  function handleInput(next: string): void {
    setDraft(next);
    scheduleChange(next);
  }

  function flushNow(next: string): void {
    if (timerRef.current) clearTimeout(timerRef.current);
    onChange(next);
  }

  function handleClear(): void {
    setDraft('');
    flushNow('');
  }

  return (
    <div className="relative w-full max-w-md">
      <input
        type="search"
        value={draft}
        onChange={(event) => handleInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') flushNow(draft);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
      />
      {draft && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Limpiar búsqueda"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-slate-400 outline-none transition-colors hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          ×
        </button>
      )}
      {loading && (
        <span role="status" className="sr-only">
          Buscando…
        </span>
      )}
    </div>
  );
}
