'use client';

import { useMemo, useState } from 'react';
import type { SequenceExecutionSummary } from '../../../../lib/sequence-execution-types';
import {
  ClickableTableRow,
  DataTable,
  DataTableContainer,
  DataTableHeader,
  DataTableHeaderCell,
  EmptyTableState,
  PrimaryItemLink,
} from '../../../../components/ui/data-table';
import { EntitySearchInput } from '../../../../components/ui/entity-search-input';
import { matchesSearch } from '../../../../lib/search';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  VALIDATING: 'Validando',
  SUBMITTING: 'Enviando…',
  SUBMISSION_UNKNOWN: 'Verificando envío…',
  ACCEPTED: 'Aceptada',
  RUNNING: 'En ejecución',
  COMPLETED: 'Completada',
  FAILED: 'Fallida',
  REJECTED: 'Rechazada',
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  VALIDATING: 'bg-amber-100 text-amber-700',
  SUBMITTING: 'bg-amber-100 text-amber-700',
  SUBMISSION_UNKNOWN: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  RUNNING: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-700',
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('es-CL') : '—';
}

function nameOrDraftLabel(execution: SequenceExecutionSummary): string {
  return execution.name ?? `Borrador creado el ${new Date(execution.createdAt).toLocaleDateString('es-CL')}`;
}

/** Only from real per-execution counts — never a derived/estimated number. Omits any segment that's null instead of showing a misleading 0. */
function progressSummary(execution: SequenceExecutionSummary): string {
  const parts: string[] = [];
  if (execution.sentCount !== null) parts.push(`${execution.sentCount} enviados`);
  if (execution.pendingCount !== null) parts.push(`${execution.pendingCount} pendientes`);
  if (execution.failedCount !== null) parts.push(`${execution.failedCount} con error`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * §9 — reduced from 15 technical columns to the 6 needed to supervise
 * gestiones at a glance; every field removed from here (dominio, plantilla,
 * IDs, timestamps de motor, estado del servidor, estado inicial de
 * prospectos) is already shown in the detail page
 * (sequence-execution-detail.tsx) — nothing was deleted, only stopped
 * being repeated in the list. §11 — `/admin/sequence-executions` returns
 * every execution in the org in one request (no backend pagination), so
 * search filters client-side.
 */
export function AdminSequenceExecutionsList({ executions }: { executions: SequenceExecutionSummary[] }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () =>
      executions.filter((execution) =>
        matchesSearch(search, nameOrDraftLabel(execution), execution.clientName, execution.mailboxEmail),
      ),
    [executions, search],
  );

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Monitor de gestiones</h1>
        <p className="text-sm text-slate-500">
          Solo lectura — gestiones creadas por los ejecutivos y su estado reportado por el servidor.
        </p>
      </div>

      {executions.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Todavía no hay gestiones creadas en la organización.
        </div>
      ) : (
        <>
          <EntitySearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por gestión, cliente o correo"
            ariaLabel="Buscar gestiones"
          />

          <DataTableContainer>
            <DataTable>
              <DataTableHeader>
                <DataTableHeaderCell>Gestión</DataTableHeaderCell>
                <DataTableHeaderCell>Cliente / Cuenta</DataTableHeaderCell>
                <DataTableHeaderCell>Ejecutivo</DataTableHeaderCell>
                <DataTableHeaderCell>Estado</DataTableHeaderCell>
                <DataTableHeaderCell>Progreso</DataTableHeaderCell>
                <DataTableHeaderCell>Última actualización</DataTableHeaderCell>
              </DataTableHeader>
              <tbody>
                {filtered.map((execution) => {
                  const href = `/dashboard/admin/sequence-executions/${execution.id}`;
                  const label = nameOrDraftLabel(execution);
                  return (
                    <ClickableTableRow key={execution.id} href={href} ariaLabel={`Abrir gestión ${label}`}>
                      <td className="px-4 py-3">
                        <PrimaryItemLink href={href}>{label}</PrimaryItemLink>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-slate-800">{execution.clientName ?? '—'}</span>
                          <span className="text-xs text-slate-500">{execution.mailboxEmail}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{execution.executiveName}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[execution.status]}`}>
                          {STATUS_LABELS[execution.status] ?? execution.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{progressSummary(execution)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(execution.lastSyncedAt)}</td>
                    </ClickableTableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <EmptyTableState colSpan={6} message={`No encontramos gestiones que coincidan con "${search}".`} />
                )}
              </tbody>
            </DataTable>
          </DataTableContainer>
        </>
      )}
    </div>
  );
}
