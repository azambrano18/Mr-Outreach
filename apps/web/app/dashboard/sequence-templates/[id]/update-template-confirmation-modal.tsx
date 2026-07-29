'use client';

export interface TemplateUpdateImpact {
  currentVersion: number | null;
  activeExecutionsCount: number;
}

/**
 * §14 — shown only when updating an ALREADY-published template (never for
 * the first publish, which uses PublishConfirmationModal instead). The
 * copy is the exact text the spec requires: changes only reach future,
 * not-yet-started envíos; already-sent correos are never touched.
 */
export function UpdateTemplateConfirmationModal({
  templateName,
  impact,
  modifiedFieldsSummary,
  updating,
  error,
  onCancel,
  onConfirm,
}: {
  templateName: string;
  impact: TemplateUpdateImpact | null;
  modifiedFieldsSummary: string;
  updating: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const currentVersion = impact?.currentVersion ?? null;
  const newVersion = currentVersion !== null ? currentVersion + 1 : null;
  const hasActiveExecutions = (impact?.activeExecutionsCount ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Confirmar actualización de plantilla</h2>
          <p className="mt-1 text-sm text-slate-600">
            Esta plantilla está siendo utilizada por Gestiones activas. Los cambios se aplicarán únicamente a envíos
            futuros que todavía no hayan comenzado. Los correos ya enviados no serán modificados.
          </p>
        </div>

        <section className="rounded-md border border-slate-200 p-3">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Plantilla</dt>
            <dd className="text-slate-900">{templateName}</dd>
            <dt className="text-slate-500">Versión actual</dt>
            <dd className="text-slate-900">{currentVersion ?? '—'}</dd>
            <dt className="text-slate-500">Nueva versión</dt>
            <dd className="text-slate-900">{newVersion ?? '—'}</dd>
            <dt className="text-slate-500">Campos modificados</dt>
            <dd className="text-slate-900">{modifiedFieldsSummary || 'Contenido de los envíos y/o asunto'}</dd>
            <dt className="text-slate-500">Fecha de aplicación</dt>
            <dd className="text-slate-900">Inmediata, al confirmar</dd>
          </dl>
        </section>

        <section className="rounded-md border border-slate-200 p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Gestiones activas afectadas</h3>
          {hasActiveExecutions ? (
            <p className="text-sm text-slate-700">
              Se estima que <span className="font-medium">{impact?.activeExecutionsCount}</span> Gestión(es) activa(s)
              usan esta plantilla; sus envíos pendientes usarán la nueva versión una vez confirmada la actualización.
            </p>
          ) : (
            <p className="text-sm text-slate-500">Actualmente no hay Gestiones activas utilizando esta Plantilla.</p>
          )}
          <p className="mt-2 text-xs text-amber-700">
            El historial de envíos ya realizados no puede modificarse, independientemente de esta actualización.
          </p>
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={updating}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Volver a editar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={updating}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {updating ? 'Actualizando…' : 'Confirmar actualización'}
          </button>
        </div>
      </div>
    </div>
  );
}
