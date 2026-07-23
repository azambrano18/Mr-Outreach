'use client';

import { Braces, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface EditorVariable {
  key: string;
  label: string;
}

export function VariableInsertMenu({
  variables,
  onInsert,
}: {
  variables: EditorVariable[];
  onInsert: (key: string) => void;
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
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative self-start">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
      >
        <Braces className="h-3.5 w-3.5" />
        Insertar variable
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex w-64 flex-col gap-0.5 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg">
          {variables.map((variable) => (
            <button
              key={variable.key}
              type="button"
              onClick={() => {
                onInsert(variable.key);
                setOpen(false);
              }}
              className="flex items-center justify-between rounded px-2 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-brand-50"
            >
              <span>{variable.label}</span>
              <span className="font-mono text-brand-700">{`{${variable.key}}`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
