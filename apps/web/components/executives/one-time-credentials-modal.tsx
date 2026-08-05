'use client';

import { useState } from 'react';
import { Modal } from '../ui/modal';

/**
 * Shown exactly once, right after POST /users or POST /users/:id/reset-password
 * respond with a freshly generated temporary password — the backend never
 * returns it again after this response. Closing clears local state so the
 * password isn't retained in memory after the modal unmounts.
 */
export function OneTimeCredentialsModal({
  open,
  onClose,
  email,
  temporaryPassword,
  roleLabel,
  restored,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  temporaryPassword: string;
  /** e.g. "Administrador"/"Ejecutivo" — shown as "{roleLabel} creado/restaurado correctamente." when provided. */
  roleLabel?: string;
  /** True when this call restored a previously deleted user instead of creating a new one — changes "creado" to "restaurado". */
  restored?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${email}\n${temporaryPassword}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied — the credentials are still visible on screen either way.
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Credenciales temporales">
      <div className="flex flex-col gap-3">
        {roleLabel && (
          <p className="text-sm font-medium text-emerald-700">
            {roleLabel} {restored ? 'restaurado' : 'creado'} correctamente.
          </p>
        )}
        <h3 className="text-sm font-semibold text-slate-900">Credenciales temporales</h3>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Esta contraseña solo se mostrará una vez. El usuario deberá cambiarla al iniciar sesión.
        </p>
        <dl className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-slate-500">Correo institucional</dt>
            <dd className="font-mono text-slate-800">{email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Contraseña temporal</dt>
            <dd className="select-all font-mono text-slate-800">{temporaryPassword}</dd>
          </div>
        </dl>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand-300 hover:text-brand-700"
          >
            {copied ? 'Copiado ✓' : 'Copiar credenciales'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
