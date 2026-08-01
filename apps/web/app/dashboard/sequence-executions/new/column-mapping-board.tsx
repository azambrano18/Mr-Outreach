'use client';

import { useState } from 'react';
import { DEFAULT_TEMPLATE_VARIABLES } from '@outreach/validation';

export interface MappingField {
  key: string;
  label: string;
  required: boolean;
}

// Only "email" is required to start a gestión — the other default
// variables are optional per-row data, same as a custom variable.
const REQUIRED_DEFAULT_KEYS = new Set(['email']);

export const STANDARD_MAPPING_FIELDS: MappingField[] = DEFAULT_TEMPLATE_VARIABLES.map((variable) => ({
  key: variable.key,
  label: variable.label,
  required: REQUIRED_DEFAULT_KEYS.has(variable.key),
}));

/**
 * §8 — two-panel drag-and-drop column mapping. Every drop zone also accepts
 * a plain click/keyboard flow (select a column card, then activate a field)
 * so mapping never depends on drag-and-drop actually working — required for
 * keyboard users, touch devices and browsers without full HTML5 DnD support.
 */
export function ColumnMappingBoard({
  headers,
  previewRows,
  customFields,
  assignments,
  onChange,
}: {
  headers: string[];
  previewRows: Record<string, string>[];
  customFields: MappingField[];
  assignments: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [dragOverField, setDragOverField] = useState<string | null>(null);

  const fields = [...STANDARD_MAPPING_FIELDS, ...customFields];
  const assignedColumns = new Set(Object.values(assignments));

  function assign(fieldKey: string, column: string): void {
    const next = { ...assignments };
    for (const key of Object.keys(next)) {
      if (next[key] === column) delete next[key];
    }
    next[fieldKey] = column;
    onChange(next);
    setSelectedColumn(null);
  }

  function unassign(fieldKey: string): void {
    const next = { ...assignments };
    delete next[fieldKey];
    onChange(next);
  }

  function exampleValuesFor(header: string): string[] {
    return [...new Set(previewRows.map((row) => row[header]?.trim()).filter((v): v is string => Boolean(v)))].slice(0, 3);
  }

  function emptyCountFor(header: string): number {
    return previewRows.filter((row) => !row[header]?.trim()).length;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Arrastra una columna del archivo hacia el campo de Mr Outreach correspondiente, o selecciónala y luego haz
          clic en el campo destino.
        </p>
        {Object.keys(assignments).length > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="whitespace-nowrap rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Restablecer mapeo
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Columnas del archivo</h3>
          <div className="flex flex-col gap-2">
            {headers.map((header) => {
              const isAssigned = assignedColumns.has(header);
              const isSelected = selectedColumn === header;
              return (
                <button
                  key={header}
                  type="button"
                  draggable
                  aria-pressed={isSelected}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', header);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => setSelectedColumn(isSelected ? null : header)}
                  className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200'
                      : isAssigned
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 font-medium text-slate-800">
                    {header}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        isAssigned ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {isAssigned ? 'Asignada' : 'Disponible'}
                    </span>
                  </span>
                  <span className="truncate text-xs text-slate-500">
                    {exampleValuesFor(header).join(', ') || 'Sin valores de ejemplo'}
                  </span>
                  <span className="text-[11px] text-slate-400">{emptyCountFor(header)} valores vacíos en la muestra</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Campos de Mr Outreach</h3>
          <div className="flex flex-col gap-2">
            {fields.map((field) => {
              const assignedColumn = assignments[field.key];
              const isDragOver = dragOverField === field.key;
              const exampleResult = assignedColumn ? exampleValuesFor(assignedColumn)[0] : undefined;
              return (
                <div
                  key={field.key}
                  role="button"
                  tabIndex={0}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverField(field.key);
                  }}
                  onDragLeave={() => setDragOverField((current) => (current === field.key ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOverField(null);
                    const column = event.dataTransfer.getData('text/plain');
                    if (column) assign(field.key, column);
                  }}
                  onClick={() => selectedColumn && assign(field.key, selectedColumn)}
                  onKeyDown={(event) => {
                    if ((event.key === 'Enter' || event.key === ' ') && selectedColumn) {
                      event.preventDefault();
                      assign(field.key, selectedColumn);
                    }
                  }}
                  className={`flex flex-col gap-1 rounded-md border-2 border-dashed px-3 py-2 text-sm transition-colors ${
                    isDragOver
                      ? 'border-brand-500 bg-brand-50'
                      : assignedColumn
                        ? 'border-emerald-300 bg-emerald-50'
                        : field.required
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 font-medium text-slate-800">
                    {field.label}
                    <span className="flex items-center gap-1.5">
                      {field.required && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                          Requerido
                        </span>
                      )}
                      {assignedColumn && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                          ✓ Mapeado
                        </span>
                      )}
                    </span>
                  </span>
                  {assignedColumn ? (
                    <>
                      <span className="text-xs text-slate-600">
                        Columna: <span className="font-medium">{assignedColumn}</span>
                        {exampleResult ? ` · ej: "${exampleResult}"` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          unassign(field.key);
                        }}
                        className="self-start text-xs text-red-600 underline-offset-2 hover:underline"
                      >
                        Quitar asignación
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">
                      {selectedColumn ? 'Haz clic aquí para asignar' : 'Suelta una columna aquí'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
