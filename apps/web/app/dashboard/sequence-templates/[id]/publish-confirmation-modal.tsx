'use client';

import { sanitizeRichTextHtml } from '../../../../lib/sanitize-html-client';

interface EnvioDraft {
  stepNumber: 1 | 2 | 3;
  headerText: string | null;
  bodyHtml: string;
  scheduleDescription: string;
}

export function PublishConfirmationModal({
  clientName,
  mailboxEmail,
  templateName,
  subjectTemplate,
  signatureHtml,
  timezone,
  envios,
  publishing,
  error,
  onCancel,
  onConfirm,
}: {
  clientName: string | null;
  mailboxEmail: string;
  templateName: string;
  subjectTemplate: string;
  signatureHtml: string;
  timezone: string;
  envios: EnvioDraft[];
  publishing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Confirmar publicación de plantilla</h2>
          <p className="mt-1 text-sm text-slate-600">
            Una vez publicada, esta versión quedará registrada y será enviada al servidor. Revisa la configuración
            antes de continuar.
          </p>
        </div>

        <section className="rounded-md border border-slate-200 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Información general</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Cliente</dt>
            <dd className="text-slate-900">{clientName ?? '—'}</dd>
            <dt className="text-slate-500">Cuenta de correo</dt>
            <dd className="text-slate-900">{mailboxEmail}</dd>
            <dt className="text-slate-500">Nombre de la plantilla</dt>
            <dd className="text-slate-900">{templateName}</dd>
            <dt className="text-slate-500">Asunto</dt>
            <dd className="text-slate-900">{subjectTemplate}</dd>
            <dt className="text-slate-500">Zona horaria</dt>
            <dd className="text-slate-900">{timezone}</dd>
            <dt className="text-slate-500">Firma</dt>
            <dd className="text-slate-900">{signatureHtml.trim() ? 'Configurada' : 'Sin firma configurada'}</dd>
          </dl>
        </section>

        {envios.map((envio) => (
          <section key={envio.stepNumber} className="rounded-md border border-slate-200 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Envío {envio.stepNumber}</h3>
            {envio.headerText && (
              <p className="mb-2 rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
                {envio.headerText}
              </p>
            )}
            <div
              className="prose-signature mb-2 max-h-32 overflow-y-auto rounded-md border border-slate-100 bg-slate-50 p-2 text-sm"
              dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(envio.bodyHtml) || '<p class="text-slate-400">Sin contenido</p>' }}
            />
            <p className="text-xs text-slate-500">{envio.scheduleDescription}</p>
          </section>
        ))}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={publishing}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Volver a editar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={publishing}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {publishing ? 'Publicando…' : 'Confirmar y publicar'}
          </button>
        </div>
      </div>
    </div>
  );
}
