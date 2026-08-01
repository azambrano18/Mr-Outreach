'use client';

import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function ImageUploadButton({
  onUploaded,
  uploadUrl = '/api/uploads/images',
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
  accept = 'image/png,image/jpeg,image/gif,image/webp',
}: {
  onUploaded: (url: string) => void;
  /** Fase 2 (R2) — which BFF proxy route to POST the multipart file to; defaults to the generic (legacy) uploads endpoint. */
  uploadUrl?: string;
  /** Client-side hint only (UX) — the server always re-validates for real. */
  maxBytes?: number;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    if (file.size > maxBytes) {
      setError(`La imagen supera el tamaño máximo permitido (${Math.round(maxBytes / (1024 * 1024))} MB).`);
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(uploadUrl, { method: 'POST', body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'No se pudo subir la imagen.');
        return;
      }
      const body = await response.json();
      // The generic /uploads/images endpoint returns { url }; the
      // signature/email-body asset endpoints return { publicUrl, ... }.
      onUploaded(body.url ?? body.publicUrl);
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Insertar imagen"
        aria-label="Insertar imagen"
        className="rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
      >
        <ImagePlus className="h-4 w-4" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {uploading && <span className="text-xs text-slate-500">Subiendo…</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
