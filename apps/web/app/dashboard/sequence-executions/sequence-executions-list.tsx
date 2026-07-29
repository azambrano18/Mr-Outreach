'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { SequenceExecutionSummary } from '../../../lib/sequence-execution-types';

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

type TabKey = 'drafts' | 'running' | 'completed' | 'problems';

const TAB_LABELS: Record<TabKey, string> = {
  drafts: 'Borradores',
  running: 'En ejecución',
  completed: 'Finalizadas',
  problems: 'Con problemas',
};

/** §6 — visually separate sections, not a status filter over one shared table. "En ejecución" groups every server-submitted-but-not-finished state (SUBMITTING/SUBMISSION_UNKNOWN/ACCEPTED/RUNNING — QUEUED/PROCESSING are server-reported substates of these, not distinct local statuses). */
function bucketFor(execution: SequenceExecutionSummary): TabKey {
  if (execution.status === 'DRAFT' || execution.status === 'VALIDATING') return 'drafts';
  if (execution.status === 'COMPLETED') return 'completed';
  if (execution.status === 'FAILED' || execution.status === 'REJECTED') return 'problems';
  return 'running'; // SUBMITTING, SUBMISSION_UNKNOWN, ACCEPTED, RUNNING
}

function nameOrDraftLabel(execution: SequenceExecutionSummary): string {
  if (execution.name) return execution.name;
  return `Borrador creado el ${new Date(execution.createdAt).toLocaleDateString('es-CL')}`;
}

export function SequenceExecutionsList({ executions }: { executions: SequenceExecutionSummary[] }) {
  const [tab, setTab] = useState<TabKey>('running');

  const buckets = useMemo(() => {
    const grouped: Record<TabKey, SequenceExecutionSummary[]> = { drafts: [], running: [], completed: [], problems: [] };
    for (const execution of executions) grouped[bucketFor(execution)].push(execution);
    return grouped;
  }, [executions]);

  const visible = buckets[tab];

  return (
    <div className="flex flex-col gap-4">
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

      {visible.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {executions.length === 0
            ? 'Todavía no has iniciado ninguna gestión.'
            : `No tienes gestiones en "${TAB_LABELS[tab]}".`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Nombre</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Cliente</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Cuenta</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Plantilla</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Prospectos</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Recibida por el servidor</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((execution) => (
                <tr key={execution.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{nameOrDraftLabel(execution)}</td>
                  <td className="px-4 py-3 text-slate-600">{execution.clientName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{execution.mailboxEmail}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {execution.templateName} (v{execution.templateVersionNumber})
                  </td>
                  <td className="px-4 py-3 text-slate-600">{execution.prospectCount ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {execution.receivedAt ? new Date(execution.receivedAt).toLocaleString('es-CL') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[execution.status]}`}>
                      {STATUS_LABELS[execution.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/sequence-executions/${execution.id}`} className="text-brand-600 hover:underline">
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
