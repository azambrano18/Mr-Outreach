'use client';

import { useRouter } from 'next/navigation';
import { ConfirmButton } from '../../../components/ui/confirm-button';

export function ToggleStatusButton({ userId, active }: { userId: string; active: boolean }) {
  const router = useRouter();

  async function handleConfirm(): Promise<void> {
    await fetch(`/api/users/${userId}/${active ? 'deactivate' : 'activate'}`, { method: 'POST' });
    router.refresh();
  }

  return (
    <ConfirmButton
      label={active ? 'Desactivar' : 'Activar'}
      confirmTitle={active ? 'Desactivar ejecutivo' : 'Activar ejecutivo'}
      confirmMessage={
        active ? (
          <ul className="list-disc space-y-1 pl-4">
            <li>El ejecutivo no podrá iniciar sesión.</li>
            <li>No se eliminará su historial.</li>
            <li>No se eliminarán sus clientes asignados.</li>
            <li>No se eliminarán sus cuentas de correo.</li>
            <li>No se cancelarán automáticamente sus datos históricos.</li>
          </ul>
        ) : (
          'El ejecutivo podrá volver a iniciar sesión con sus credenciales existentes.'
        )
      }
      confirmLabel={active ? 'Desactivar' : 'Activar'}
      onConfirm={handleConfirm}
      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
    />
  );
}
