'use client';

import { useRouter } from 'next/navigation';
import { ConfirmButton } from '../ui/confirm-button';

export function ToggleDomainStatusButton({ domainId, active }: { domainId: string; active: boolean }) {
  const router = useRouter();

  async function handleConfirm(): Promise<void> {
    await fetch(`/api/domains/${domainId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: active ? 'INACTIVE' : 'ACTIVE' }),
    });
    router.refresh();
  }

  return (
    <ConfirmButton
      label={active ? 'Desactivar' : 'Activar'}
      confirmTitle={active ? 'Desactivar dominio' : 'Activar dominio'}
      confirmMessage={
        active
          ? 'Las cuentas de correo vinculadas a este dominio se conservan, pero el dominio quedará inactivo.'
          : 'El dominio volverá a estar operativo.'
      }
      confirmLabel={active ? 'Desactivar' : 'Activar'}
      onConfirm={handleConfirm}
      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
    />
  );
}
