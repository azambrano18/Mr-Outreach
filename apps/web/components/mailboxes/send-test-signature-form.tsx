'use client';

import { useState, type FormEvent } from 'react';

export function SendTestSignatureForm({
  mailboxId,
  mine = false,
}: {
  mailboxId: string;
  /** Executive self-service mode — hits /api/me/mailboxes instead of /api/mailboxes. */
  mine?: boolean;
}) {
  const [to, setTo] = useState('');
  const [result, setResult] = useState<{ accepted: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const mailboxesApi = mine ? '/api/me/mailboxes' : '/api/mailboxes';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setResult(null);
    setLoading(true);
    try {
      const response = await fetch(`${mailboxesApi}/${mailboxId}/signature/send-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult({ accepted: false, message: body.error ?? 'No se pudo enviar la prueba.' });
        return;
      }
      setResult(body);
    } catch {
      setResult({ accepted: false, message: 'No se pudo contactar la API.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Enviar correo de prueba
      </span>
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          required
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="destinatario@ejemplo.com"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
        >
          {loading ? 'Enviando…' : 'Enviar prueba'}
        </button>
      </div>
      {result && (
        <p className={`text-sm ${result.accepted ? 'text-emerald-700' : 'text-red-600'}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}
