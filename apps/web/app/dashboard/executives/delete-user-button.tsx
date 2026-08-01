'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DeletionImpact } from '@outreach/shared-types';
import { Modal } from '../../../components/ui/modal';

const CONFIRM_WORD = 'ELIMINAR';

/**
 * Available for both ADMIN and EXECUTIVE users holding `users.delete` — the
 * backend (`UsersService.remove`) enforces every rule shown here
 * independently; this component only previews them (via
 * `/users/:id/deletion-impact`) and requires typing "ELIMINAR" before it
 * will even attempt the DELETE call. It never assumes the preview is still
 * accurate by the time of submission — a stale preview just means the
 * backend rejects the attempt and its message is shown instead.
 */
export function DeleteUserButton({
  userId,
  name,
  email,
  roleName,
}: {
  userId: string;
  name: string;
  email: string;
  roleName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleOpen(): Promise<void> {
    setOpen(true);
    setConfirmText('');
    setSubmitError(null);
    setImpactError(null);
    setImpact(null);
    setLoadingImpact(true);
    try {
      const response = await fetch(`/api/users/${userId}/deletion-impact`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setImpactError(body.error ?? 'No se pudo cargar la información de esta eliminación.');
        return;
      }
      setImpact(body as DeletionImpact);
    } catch {
      setImpactError('No se pudo contactar la API.');
    } finally {
      setLoadingImpact(false);
    }
  }

  function handleClose(): void {
    if (submitting) return;
    setOpen(false);
  }

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setSubmitError(body.error ?? 'No se pudo eliminar al usuario.');
        return;
      }
      router.push('/dashboard/executives');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const canConfirm = confirmText.trim() === CONFIRM_WORD && impact?.canDelete === true;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
      >
        Eliminar usuario
      </button>
      {submitError && <p className="max-w-sm text-right text-xs text-red-600">{submitError}</p>}

      <Modal open={open} onClose={handleClose} title="Eliminar usuario">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Eliminar usuario</h3>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Nombre</dt>
            <dd className="text-slate-800">{name}</dd>
            <dt className="text-slate-500">Correo</dt>
            <dd className="text-slate-800">{email}</dd>
            <dt className="text-slate-500">Rol</dt>
            <dd className="text-slate-800">{roleName}</dd>
          </dl>

          {loadingImpact && <p className="text-sm text-slate-500">Cargando información…</p>}
          {impactError && <p className="text-sm text-red-600">{impactError}</p>}
          {impact && (
            <ul className="list-disc space-y-1 pl-4 text-sm text-slate-600">
              <li>Cuentas de correo donde es principal: {impact.primaryMailboxCount}</li>
              <li>Cuentas de correo donde es secundario: {impact.secondaryMailboxCount} (se le quitarán automáticamente)</li>
              <li>Gestiones activas: {impact.activeExecutionCount}</li>
              {impact.primaryMailboxCount > 0 && (
                <li className="text-red-600">Reasigna esas cuentas de correo antes de poder eliminarlo.</li>
              )}
              {impact.activeExecutionCount > 0 && (
                <li className="text-red-600">
                  Esas gestiones deben completarse, fallar o reasignarse antes de poder eliminarlo.
                </li>
              )}
              {impact.isLastActiveAdmin && (
                <li className="text-red-600">Es el último administrador activo de la organización — no puede eliminarse.</li>
              )}
              {impact.isSelf && <li className="text-red-600">No puedes eliminar tu propia cuenta.</li>}
              {impact.isProtectedSystemAccount && <li className="text-red-600">Esta cuenta está protegida por el sistema.</li>}
            </ul>
          )}

          <p className="text-sm text-slate-600">
            Esta acción eliminará al usuario de la aplicación, revocará su acceso y lo quitará de los listados y
            selectores activos. El historial necesario para auditoría será conservado.
          </p>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-700">
              Escribe <strong>{CONFIRM_WORD}</strong> para confirmar
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              autoComplete="off"
            />
          </label>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm || submitting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
