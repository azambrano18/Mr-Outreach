'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { isValidVariableKey, normalizeVariableKey } from '@outreach/validation';

export function CreateVariableForm() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const normalizedKey = normalizeVariableKey(key);
  const keyIsValid = key === '' || isValidVariableKey(normalizedKey);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/variables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, label }),
      });

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        setError(responseBody.error ?? 'No se pudo crear la variable.');
        return;
      }

      router.push('/dashboard/variables');
      router.refresh();
    } catch {
      setError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5"
    >
      <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="variable-key">
        Variable
        <input
          id="variable-key"
          required
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="empresa"
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        {key && (
          <span className="text-xs text-slate-500">
            Se insertará en el asunto o el cuerpo del correo como{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">{`{${normalizedKey}}`}</code>
          </span>
        )}
        {!keyIsValid && (
          <span className="text-xs text-red-600">
            Usa solo minúsculas, números y guion bajo, sin espacios ni empezar con número.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="variable-label">
        Nombre
        <input
          id="variable-label"
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Empresa Prospecto"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !keyIsValid}
        className="self-start rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Creando…' : 'Crear variable'}
      </button>
    </form>
  );
}
