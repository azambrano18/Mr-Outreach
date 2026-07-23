'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Fase 1.5 — "Activar en Mr Outreach": creates (or refreshes, if it already
 * exists) the local ManagedClient linked to a CRM row already shown in the
 * crm-overview list, using only that row's crmClientId — name/RUT/rubro/
 * estado are never sent from here, the backend always re-derives them from
 * maestro_clientes (see ClientsService.upsertFromVerifiedCrmClient). `name`
 * is only used locally for the button's own copy while loading/erroring.
 */
export function ConfigureClientButton({ crmClientId, name }: { crmClientId: number; name: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crmClientId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? `No se pudo activar ${name} en Mr Outreach.`);
        return;
      }
      router.push(`/dashboard/clients/${body.id}`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Activando…' : 'Activar en Mr Outreach'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
