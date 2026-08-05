'use client';

import { useMemo, useState } from 'react';
import type { SequenceExecutionSummary } from '../../../lib/sequence-execution-types';
import {
  ClickableTableRow,
  DataTable,
  DataTableContainer,
  DataTableHeader,
  DataTableHeaderCell,
  EmptyTableState,
  PrimaryItemLink,
} from '../../../components/ui/data-table';
import { EntitySearchInput } from '../../../components/ui/entity-search-input';
import { matchesSearch } from '../../../lib/search';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  VALIDATING: 'Validando',
  SUBMITTING: 'Enviando…',
  SUBMISSION_UNKNOWN: 'Verificando envío…',
  ACCEPTED: 'Aceptada',
  RUNNING: 'En ejecución',
  PAUSE_REQUESTED: 'Pausando…',
  PAUSED: 'Pausada',
  RESUME_REQUESTED: 'Reanudando…',
  STOP_REQUESTED: 'Deteniendo…',
  STOPPED: 'Detenida',
  RESTART_REQUESTED: 'Reiniciando…',
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
  PAUSE_REQUESTED: 'bg-amber-100 text-amber-700',
  PAUSED: 'bg-slate-200 text-slate-700',
  RESUME_REQUESTED: 'bg-amber-100 text-amber-700',
  STOP_REQUESTED: 'bg-amber-100 text-amber-700',
  STOPPED: 'bg-slate-200 text-slate-700',
  RESTART_REQUESTED: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-700',
};

type TabKey = 'drafts' | 'running' | 'completed' | 'problems';

const TAB_LABELS: Record<TabKey, string> = {
  drafts: 'Borradores',
  running: 'En ejecución',
  completed: 'Finalizadas',
  problems: 'Con problemas',
};

/**
 * §6 — visually separate sections, not a status filter over one shared table. "En ejecución"
 * groups every server-submitted-but-not-finished state (SUBMITTING/SUBMISSION_UNKNOWN/ACCEPTED/
 * RUNNING — QUEUED/PROCESSING are server-reported substates of these, not distinct local
 * statuses) plus the pause/resume control states (PAUSE_REQUESTED/PAUSED/RESUME_REQUESTED/
 * STOP_REQUESTED) — a paused Gestión is still "in flight", not finished. STOPPED is grouped
 * under "Con problemas" since, unlike COMPLETED, it never finished its own sends and needs
 * admin attention (restart) to continue.
 */
function bucketFor(execution: SequenceExecutionSummary): TabKey {
  if (execution.status === 'DRAFT' || execution.status === 'VALIDATING') return 'drafts';
  if (execution.status === 'COMPLETED') return 'completed';
  if (execution.status === 'FAILED' || execution.status === 'REJECTED' || execution.status === 'STOPPED') return 'problems';
  return 'running'; // SUBMITTING, SUBMISSION_UNKNOWN, ACCEPTED, RUNNING, PAUSE_REQUESTED, PAUSED, RESUME_REQUESTED, STOP_REQUESTED, RESTART_REQUESTED
}

function nameOrDraftLabel(execution: SequenceExecutionSummary): string {
  if (execution.name) return execution.name;
  return `Borrador creado el ${new Date(execution.createdAt).toLocaleDateString('es-CL')}`;
}

/**
 * §11 — the executive's own Gestiones are already loaded in full (no
 * backend pagination), so search filters client-side. Plantilla y
 * Prospectos se movieron al detalle (ya estaban ahí) — la lista solo
 * necesita lo esencial para identificar y abrir una gestión.
 */
export function SequenceExecutionsList({ executions }: { executions: SequenceExecutionSummary[] }) {
  const [tab, setTab] = useState<TabKey>('running');
  const [search, setSearch] = useState('');

  const buckets = useMemo(() => {
    const grouped: Record<TabKey, SequenceExecutionSummary[]> = { drafts: [], running: [], completed: [], problems: [] };
    for (const execution of executions) grouped[bucketFor(execution)].push(execution);
    return grouped;
  }, [executions]);

  const visible = buckets[tab];
  const filtered = useMemo(
    () =>
      visible.filter((execution) =>
        matchesSearch(search, nameOrDraftLabel(execution), execution.clientName, execution.mailboxEmail),
      ),
    [visible, search],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {TAB_LABELS[key]} ({buckets[key].length})
            </button>
          ))}
        </div>
        <EntitySearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por gestión, cliente o correo"
          ariaLabel="Buscar gestiones"
        />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {executions.length === 0
            ? 'Todavía no has iniciado ninguna gestión.'
            : `No tienes gestiones en "${TAB_LABELS[tab]}".`}
        </div>
      ) : (
        <DataTableContainer>
          <DataTable>
            <DataTableHeader>
              <DataTableHeaderCell>Gestión</DataTableHeaderCell>
              <DataTableHeaderCell>Cliente</DataTableHeaderCell>
              <DataTableHeaderCell>Cuenta</DataTableHeaderCell>
              <DataTableHeaderCell>Estado</DataTableHeaderCell>
              <DataTableHeaderCell>Recibida por el servidor</DataTableHeaderCell>
            </DataTableHeader>
            <tbody>
              {filtered.map((execution) => {
                const href = `/dashboard/sequence-executions/${execution.id}`;
                const label = nameOrDraftLabel(execution);
                return (
                  <ClickableTableRow key={execution.id} href={href} ariaLabel={`Abrir gestión ${label}`}>
                    <td className="px-4 py-3">
                      <PrimaryItemLink href={href}>{label}</PrimaryItemLink>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{execution.clientName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{execution.mailboxEmail}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[execution.status]}`}>
                        {STATUS_LABELS[execution.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {execution.receivedAt ? new Date(execution.receivedAt).toLocaleString('es-CL') : '—'}
                    </td>
                  </ClickableTableRow>
                );
              })}
              {filtered.length === 0 && (
                <EmptyTableState colSpan={5} message={`No encontramos gestiones que coincidan con "${search}".`} />
              )}
            </tbody>
          </DataTable>
        </DataTableContainer>
      )}
    </div>
  );
}
