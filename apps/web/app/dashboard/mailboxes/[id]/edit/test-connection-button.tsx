'use client';

import { useState } from 'react';
import type { MailboxTestResultSummary } from '@outreach/shared-types';

export function TestConnectionButton({ mailboxId }: { mailboxId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MailboxTestResultSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/mailboxes/${mailboxId}/test`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo probar la conexión.');
        return;
      }
      setResult(body as MailboxTestResultSummary);
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
      >
        {loading ? 'Probando…' : 'Probar conexión'}
      </button>
      {result && (
        <p className={`text-xs ${result.status === 'CONNECTED' ? 'text-emerald-700' : 'text-red-600'}`}>
          {result.message}
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
