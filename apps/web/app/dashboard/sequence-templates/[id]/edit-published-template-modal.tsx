'use client';

/** §13 — shown once, before unlocking the fields, whenever the executive starts editing an already-PUBLISHED Plantilla. */
export function EditPublishedTemplateModal({
  activeExecutionsCount,
  loadingImpact,
  onCancel,
  onConfirm,
}: {
  activeExecutionsCount: number | null;
  loadingImpact: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Editar plantilla publicada</h2>
        <p className="mt-3 text-sm text-slate-600">
          {loadingImpact
            ? 'Revisando si hay Gestiones activas con esta plantilla…'
            : activeExecutionsCount && activeExecutionsCount > 0
              ? 'Se creará una nueva versión en borrador. Las Gestiones activas continuarán utilizando la versión publicada actual. La nueva versión estará disponible únicamente para las Gestiones que se creen después de publicarla.'
              : 'Se creará una nueva versión en borrador. La versión publicada actual continuará disponible hasta que publiques la nueva versión.'}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loadingImpact}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            Crear nueva versión
          </button>
        </div>
      </div>
    </div>
  );
}
