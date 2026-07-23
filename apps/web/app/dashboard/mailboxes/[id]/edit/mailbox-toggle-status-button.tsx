'use client';

import { useRouter } from 'next/navigation';
import { ConfirmButton } from '../../../../../components/ui/confirm-button';

export function MailboxToggleStatusButton({ mailboxId, active }: { mailboxId: string; active: boolean }) {
  const router = useRouter();

  async function handleConfirm(): Promise<void> {
    await fetch(`/api/mailboxes/${mailboxId}/${active ? 'deactivate' : 'activate'}`, { method: 'POST' });
    router.refresh();
  }

  return (
    <ConfirmButton
      label={active ? 'Desactivar cuenta' : 'Activar cuenta'}
      confirmTitle={active ? 'Desactivar cuenta de correo' : 'Activar cuenta de correo'}
      confirmMessage={
        active
          ? 'La cuenta dejará de enviar y recibir correos. El historial y las secuencias asociadas se conservan.'
          : 'La cuenta podrá volver a enviar y recibir correos.'
      }
      confirmLabel={active ? 'Desactivar' : 'Activar'}
      onConfirm={handleConfirm}
      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
    />
  );
}
