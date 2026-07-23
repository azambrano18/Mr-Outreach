'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { SignaturePreview, SignatureSummary } from '@outreach/shared-types';
import { RichTextEditor } from '../rich-text-editor/rich-text-editor';
import { SIGNATURE_VARIABLES } from '../../lib/signature-variables';
import { SendTestSignatureForm } from './send-test-signature-form';

export function SignatureSection({
  mailboxId,
  initialSignature,
  canCreate,
  canUpdate,
  canActivate,
  canArchive,
  canPreview,
  canTest,
  mine = false,
}: {
  mailboxId: string;
  initialSignature: SignatureSummary | null;
  canCreate: boolean;
  canUpdate: boolean;
  canActivate: boolean;
  canArchive: boolean;
  canPreview: boolean;
  canTest: boolean;
  /** Executive self-service mode — hits /api/me/mailboxes instead of /api/mailboxes, and always PATCHes (self-service create-or-update is a single call). */
  mine?: boolean;
}) {
  const router = useRouter();
  const hasSignature = initialSignature !== null;
  const canEditForm = hasSignature ? canUpdate : canCreate;
  const mailboxesApi = mine ? '/api/me/mailboxes' : '/api/mailboxes';

  const [htmlContent, setHtmlContent] = useState(
    initialSignature?.activeVersion?.htmlContent ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<SignaturePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [versionLoading, setVersionLoading] = useState<string | null>(null);

  // Keeps the compose field in sync with whichever version is active after
  // a save or a revert (router.refresh() re-renders this component with a
  // new initialSignature, but useState's initial value only applies once).
  useEffect(() => {
    setHtmlContent(initialSignature?.activeVersion?.htmlContent ?? '');
    setPreview(null);
  }, [initialSignature]);

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`${mailboxesApi}/${mailboxId}/signature`, {
        method: mine || hasSignature ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ htmlContent }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'No se pudo guardar la firma.');
        return;
      }
      router.refresh();
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview(): Promise<void> {
    setError(null);
    setPreviewLoading(true);
    try {
      const response = await fetch(`${mailboxesApi}/${mailboxId}/signature/preview`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'No se pudo generar la vista previa.');
        return;
      }
      setPreview(await response.json());
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleArchiveRestore(): Promise<void> {
    if (!initialSignature) return;
    setLoading(true);
    try {
      const action = initialSignature.status === 'ACTIVE' ? 'archive' : 'restore';
      await fetch(`${mailboxesApi}/${mailboxId}/signature/${action}`, { method: 'POST' });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleActivateVersion(versionId: string): Promise<void> {
    setVersionLoading(versionId);
    try {
      await fetch(`${mailboxesApi}/${mailboxId}/signature/versions/${versionId}/activate`, {
        method: 'POST',
      });
      router.refresh();
    } finally {
      setVersionLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-700">Firma de la cuenta</h2>
        {hasSignature && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              initialSignature.status === 'ACTIVE'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-200 text-slate-600'
            }`}
          >
            {initialSignature.status === 'ACTIVE' ? 'Activa' : 'Archivada'}
          </span>
        )}
      </div>

      {canEditForm ? (
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <RichTextEditor
            value={htmlContent}
            onChange={setHtmlContent}
            placeholder="Nombre, cargo, empresa, teléfono…"
            variables={SIGNATURE_VARIABLES}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Guardando…' : hasSignature ? 'Guardar nueva versión' : 'Crear firma'}
            </button>
            {canPreview && hasSignature && (
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewLoading}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
              >
                {previewLoading ? 'Generando…' : 'Vista previa'}
              </button>
            )}
            {canArchive && hasSignature && (
              <button
                type="button"
                onClick={handleArchiveRestore}
                disabled={loading}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
              >
                {initialSignature?.status === 'ACTIVE' ? 'Archivar' : 'Restaurar'}
              </button>
            )}
          </div>
        </form>
      ) : hasSignature ? (
        <div
          className="prose-signature rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
          dangerouslySetInnerHTML={{ __html: initialSignature.activeVersion?.htmlContent ?? '' }}
        />
      ) : (
        <p className="text-sm text-slate-500">Esta cuenta todavía no tiene firma configurada.</p>
      )}

      {preview && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Vista previa {preview.usesRealSenderData ? 'con datos reales' : '(datos de ejemplo)'}
          </span>
          <div
            className="prose-signature rounded-md border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900"
            dangerouslySetInnerHTML={{ __html: preview.renderedHtml }}
          />
        </div>
      )}

      {canTest && hasSignature && <SendTestSignatureForm mailboxId={mailboxId} mine={mine} />}

      {hasSignature && initialSignature.versions.length > 1 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Historial de versiones
          </h3>
          <ul className="flex flex-col gap-1.5">
            {initialSignature.versions.map((version) => (
              <li
                key={version.id}
                className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">Versión {version.versionNumber}</span>
                  {version.isActive && (
                    <span className="ml-2 text-xs text-brand-700">(activa)</span>
                  )}
                  <div className="font-mono text-xs text-slate-500">
                    {new Date(version.createdAt).toLocaleString('es-CL')}
                  </div>
                </div>
                {canActivate && !version.isActive && (
                  <button
                    type="button"
                    onClick={() => handleActivateVersion(version.id)}
                    disabled={versionLoading === version.id}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
                  >
                    {versionLoading === version.id ? '…' : 'Activar esta versión'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
