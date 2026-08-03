'use client';

import { useState, type ReactNode } from 'react';
import { Modal } from './modal';

/**
 * A button that opens a confirmation modal before running its action —
 * never window.confirm (see Modal's own comment). Reused wherever an
 * action needs a "are you sure?" step (activate/deactivate/reset-password).
 */
export function ConfirmButton({
  label,
  confirmTitle,
  confirmMessage,
  confirmLabel,
  onConfirm,
  className,
  disabled,
  title,
}: {
  label: string;
  confirmTitle: string;
  confirmMessage: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  className?: string;
  disabled?: boolean;
  /** Native `title` tooltip on the trigger button — e.g. to explain why it's disabled. */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleConfirm(): Promise<void> {
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={className} title={title}>
        {label}
      </button>
      <Modal open={open} onClose={() => (loading ? undefined : setOpen(false))} title={confirmTitle}>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-900">{confirmTitle}</h3>
          <div className="text-sm text-slate-600">{confirmMessage}</div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={loading}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Procesando…' : confirmLabel}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
