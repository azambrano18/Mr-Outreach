'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { SequenceSummary } from '@outreach/shared-types';

const TABS = ['Borradores', 'Programadas', 'En ejecución', 'Historial'] as const;
type Tab = (typeof TABS)[number];

const PUBLISH_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Solicitada',
  ACCEPTED: 'Aceptada',
  PROCESSING: 'Procesando',
  SCHEDULED: 'Programada',
  ACTIVE: 'Activa',
  COMPLETED: 'Completada',
  FAILED: 'Con errores',
  CANCELLED: 'Cancelada',
};

function bucketOf(sequence: SequenceSummary): Tab {
  if (!sequence.publishStatus) return 'Borradores';
  if (sequence.publishStatus === 'FAILED' || sequence.publishStatus === 'CANCELLED' || sequence.publishStatus === 'COMPLETED') {
    return 'Historial';
  }
  if (sequence.publishStatus === 'ACTIVE') {
    const startsInFuture = sequence.effectiveStartAt ? new Date(sequence.effectiveStartAt).getTime() > Date.now() : false;
    return startsInFuture ? 'Programadas' : 'En ejecución';
  }
  return 'Programadas';
}

export function SequencesList({
  sequences,
  currentUserId,
}: {
  sequences: SequenceSummary[];
  currentUserId?: string;
}) {
  const [tab, setTab] = useState<Tab>('Borradores');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commandById, setCommandById] = useState<Record<string, unknown>>({});

  const buckets = useMemo(() => {
    const grouped: Record<Tab, SequenceSummary[]> = { Borradores: [], Programadas: [], 'En ejecución': [], Historial: [] };
    for (const sequence of sequences) grouped[bucketOf(sequence)].push(sequence);
    return grouped;
  }, [sequences]);

  async function toggleCommand(sequenceId: string): Promise<void> {
    if (expandedId === sequenceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sequenceId);
    if (!commandById[sequenceId]) {
      const response = await fetch(`/api/me/sequences/${sequenceId}/publish/command`);
      if (response.ok) {
        const body = await response.json();
        setCommandById((current) => ({ ...current, [sequenceId]: body }));
      }
    }
  }

  const rows = buckets[tab];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t} ({buckets[t].length})
            </button>
          ))}
        </div>
        <Link
          href="/dashboard/sequences/mine/new"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
        >
          Crear secuencia
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No hay secuencias en esta categoría.</p>
        )}
        {rows.map((sequence) => (
          <div key={sequence.id} className="border-b border-slate-100 last:border-0">
            <button
              type="button"
              onClick={() => void toggleCommand(sequence.id)}
              className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-slate-50 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-slate-900">{sequence.name}</span>
                <span className="text-xs text-slate-500">
                  {sequence.mailboxEmail ?? 'Sin cuenta asignada'} · {sequence.stepCount} steps
                </span>
                {currentUserId && sequence.createdBy !== currentUserId && (
                  <span className="text-[11px] text-brand-600">
                    Creada por un administrador — quedaste a cargo como responsable operativo.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                {sequence.publishStatus && (
                  <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                    {PUBLISH_STATUS_LABEL[sequence.publishStatus] ?? sequence.publishStatus}
                  </span>
                )}
                {sequence.effectiveStartAt && (
                  <span>Inicio: {new Date(sequence.effectiveStartAt).toLocaleString('es-CL')}</span>
                )}
              </div>
            </button>
            {expandedId === sequence.id && (
              <pre className="max-h-64 overflow-auto bg-slate-900 p-3 text-[11px] text-slate-100">
                {JSON.stringify(commandById[sequence.id] ?? { loading: true }, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
