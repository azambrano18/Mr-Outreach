'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmButton } from '../../../components/ui/confirm-button';

export function DeleteVariableButton({ variableId, variableKey }: { variableId: string; variableKey: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    setError(null);
    const response = await fetch(`/api/variables/${variableId}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? 'No se pudo eliminar la variable.');
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmButton
        label="Eliminar"
        confirmTitle="Eliminar variable"
        confirmMessage={`Esto elimina permanentemente {${variableKey}} del catálogo. Solo es posible si nunca se ha usado en una secuencia o firma — si ya fue usada, desactívala en vez de eliminarla.`}
        confirmLabel="Eliminar"
        onConfirm={handleConfirm}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-red-300 hover:text-red-700"
      />
      {error && <p className="max-w-[200px] text-right text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
