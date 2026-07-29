'use client';

import type { SequenceExecutionSummary } from '../../../../lib/sequence-execution-types';

/**
 * §10 — shown right before the command is sent to the server. Never shows
 * a start date/time, calendar, queue, worker, priority or technical
 * owner — the summary is limited to what the executive actually
 * configured (account, Plantilla, prospect counts, mapping).
 */
export function StartExecutionConfirmationModal({
  execution,
  validRows,
  invalidRows,
  duplicateRows,
  mappingSummary,
  starting,
  error,
  onCancel,
  onConfirm,
}: {
  execution: SequenceExecutionSummary;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  mappingSummary: string;
  starting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Confirmar inicio de gestión</h2>
          <p className="mt-1 text-sm text-slate-600">
            Al confirmar, la base será enviada al servidor utilizando la Plantilla seleccionada. El servidor
            registrará los prospectos en el Envío 1 y administrará su procesamiento.
          </p>
        </div>

        <section className="rounded-md border border-slate-200 p-3">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Cliente</dt>
            <dd className="text-slate-900">{execution.clientName ?? '—'}</dd>
            <dt className="text-slate-500">Cuenta</dt>
            <dd className="text-slate-900">{execution.mailboxEmail}</dd>
            <dt className="text-slate-500">Plantilla</dt>
            <dd className="text-slate-900">{execution.templateName}</dd>
          </dl>
        </section>

        <section className="rounded-md border border-slate-200 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Base de prospectos</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Prospectos válidos</dt>
            <dd className="text-emerald-700">{validRows}</dd>
            <dt className="text-slate-500">Prospectos inválidos</dt>
            <dd className="text-red-600">{invalidRows}</dd>
            <dt className="text-slate-500">Duplicados excluidos</dt>
            <dd className="text-amber-700">{duplicateRows}</dd>
            <dt className="text-slate-500">Variables mapeadas</dt>
            <dd className="text-slate-900">{mappingSummary}</dd>
          </dl>
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={starting}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Volver a editar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={starting}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {starting ? 'Enviando…' : 'Confirmar e iniciar'}
          </button>
        </div>
      </div>
    </div>
  );
}
