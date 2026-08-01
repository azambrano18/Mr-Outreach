'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmButton } from '../../../components/ui/confirm-button';

/**
 * Only rendered for EXECUTIVE users (never ADMIN) with `users.delete` —
 * the backend enforces the same rule independently. The backend also
 * blocks the delete (returning a clear message) if the executive is still
 * the primary assignee on a mailbox or owns an unfinished Gestión — this
 * component just surfaces whatever message comes back, it doesn't
 * pre-check dependencies itself.
 */
export function DeleteExecutiveButton({ userId, name, email }: { userId: string; name: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    setError(null);
    const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? 'No se pudo eliminar al ejecutivo.');
      return;
    }
    router.push('/dashboard/executives');
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmButton
        label="Eliminar ejecutivo"
        confirmTitle="Eliminar ejecutivo"
        confirmMessage={
          <div className="flex flex-col gap-2">
            <p>
              Vas a eliminar a <strong>{name}</strong> ({email}).
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Perderá acceso de inmediato y no podrá volver a iniciar sesión.</li>
              <li>Dejará de aparecer en los listados y selectores de ejecutivos.</li>
              <li>Su historial de auditoría se conserva — esta acción no borra registros.</li>
              <li>
                Si todavía es ejecutivo principal de alguna cuenta de correo, o tiene gestiones sin finalizar, la
                eliminación se bloqueará y se indicará qué resolver primero.
              </li>
            </ul>
          </div>
        }
        confirmLabel="Eliminar"
        onConfirm={handleConfirm}
        className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
      />
      {error && <p className="max-w-sm text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
