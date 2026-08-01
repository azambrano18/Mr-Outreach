'use client';

import { useState } from 'react';
import type { SignatureSummary } from '@outreach/shared-types';
import { RichTextEditor } from '../../../../../../components/rich-text-editor/rich-text-editor';

const MAX_SIGNATURE_IMAGE_BYTES = 1 * 1024 * 1024;

function isBlank(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').trim().length === 0;
}

export function MailboxSignatureEditor({
  mailboxId,
  initialHtml,
  canUpdate,
}: {
  mailboxId: string;
  initialHtml: string;
  canUpdate: boolean;
}) {
  const [html, setHtml] = useState(initialHtml);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/me/mailboxes/${mailboxId}/signature`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ htmlContent: html }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo guardar la firma.');
        return;
      }
      const updated = body as SignatureSummary;
      setHtml(updated.activeVersion?.htmlContent ?? html);
      setSavedAt(new Date());
    } catch {
      setError('No se pudo contactar la API.');
    } finally {
      setSaving(false);
    }
  }

  const blank = isBlank(html);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
      <p className="text-xs text-slate-500">
        Esta firma se incluye en los 3 envíos de cada Plantilla de esta cuenta — hay una sola firma por
        cuenta, compartida por todas sus Plantillas. Al publicar una Plantilla, la firma vigente en ese
        momento queda fija junto con su contenido; las Gestiones ya iniciadas conservan la firma de su
        propia versión, aunque la cuenta cambie su firma después. Imágenes: PNG, JPG o GIF, hasta
        1200x500 px y 1 MB.
      </p>

      <RichTextEditor
        value={html}
        onChange={setHtml}
        editable={canUpdate}
        placeholder="Nombre, cargo, empresa, teléfono…"
        imageUploadUrl={`/api/me/mailboxes/${mailboxId}/signature-assets`}
        imageMaxBytes={MAX_SIGNATURE_IMAGE_BYTES}
        imageAccept="image/png,image/jpeg,image/gif"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {blank && <p className="text-xs text-amber-600">Escribe al menos un carácter antes de guardar — una firma vacía no puede guardarse.</p>}

      {canUpdate && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || blank}
            className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar firma'}
          </button>
          {savedAt && <span className="text-xs text-slate-500">Guardada a las {savedAt.toLocaleTimeString('es-CL')}</span>}
        </div>
      )}
    </div>
  );
}
