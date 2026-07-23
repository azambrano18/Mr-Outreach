'use client';

import { useState } from 'react';

/**
 * §40 — plain formatted `<pre>`, no syntax highlighting: no JSON-highlighting
 * library exists anywhere in this monorepo (confirmed before building this),
 * and the spec explicitly conditions highlighting on one already being
 * installed. Copy/download cover the rest of §40's JSON-viewer requirements.
 */
export function JsonViewer({ value, fileName = 'evento.json' }: { value: unknown; fileName?: string }) {
  const [copied, setCopied] = useState(false);
  const formatted = JSON.stringify(value, null, 2);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (permissions/context) — not worth surfacing as an error state.
    }
  }

  function download(): void {
    const blob = new Blob([formatted], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-500">JSON</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-brand-300 hover:text-brand-700"
          >
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button
            type="button"
            onClick={download}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-brand-300 hover:text-brand-700"
          >
            Descargar .json
          </button>
        </div>
      </div>
      <pre className="max-h-96 overflow-auto p-3 text-xs leading-relaxed text-slate-800">{formatted}</pre>
    </div>
  );
}
