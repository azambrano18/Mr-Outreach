'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function AddDomainForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [domainName, setDomainName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`/api/clients/${clientId}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo agregar el dominio.');
        return;
      }
      setDomainName('');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-2">
      <div className="flex flex-col gap-1">
        <input
          required
          value={domainName}
          onChange={(event) => setDomainName(event.target.value)}
          placeholder="cliente.cl"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Agregando…' : 'Agregar dominio'}
      </button>
    </form>
  );
}
