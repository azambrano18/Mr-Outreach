'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ResetPasswordResult } from '@outreach/shared-types';
import { OneTimeCredentialsModal } from '../../../components/executives/one-time-credentials-modal';
import { ConfirmButton } from '../../../components/ui/confirm-button';

export function ResetPasswordButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<ResetPasswordResult | null>(null);

  async function handleConfirm(): Promise<void> {
    const response = await fetch(`/api/users/${userId}/reset-password`, { method: 'POST' });
    if (response.ok) {
      setResult((await response.json()) as ResetPasswordResult);
    }
  }

  function handleCloseCredentials(): void {
    setResult(null);
    router.refresh();
  }

  return (
    <>
      <ConfirmButton
        label="Restablecer contraseña"
        confirmTitle="Restablecer contraseña"
        confirmMessage="Se generará una nueva contraseña temporal y la anterior dejará de funcionar de inmediato. El ejecutivo deberá cambiarla al iniciar sesión."
        confirmLabel="Restablecer"
        onConfirm={handleConfirm}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
      />
      {result && (
        <OneTimeCredentialsModal
          open
          onClose={handleCloseCredentials}
          email={result.email}
          temporaryPassword={result.temporaryPassword}
        />
      )}
    </>
  );
}
