'use client';

import type { VariableSummary } from '@outreach/shared-types';

export function VariablePicker({
  variables,
  onInsert,
}: {
  variables: VariableSummary[];
  onInsert: (key: string) => void;
}) {
  if (variables.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-3">
      <span className="text-xs font-medium text-slate-500">
        Insertar variable del catálogo en el campo activo
      </span>
      <div className="flex flex-wrap gap-1.5">
        {variables.map((variable) => (
          <button
            key={variable.id}
            type="button"
            onClick={() => onInsert(variable.key)}
            title={variable.label}
            className="rounded-full bg-brand-100 px-2.5 py-1 font-mono text-xs text-brand-700 transition-colors hover:bg-brand-200"
          >
            {`{${variable.key}}`}
          </button>
        ))}
      </div>
    </div>
  );
}
