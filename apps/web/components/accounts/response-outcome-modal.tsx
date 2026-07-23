'use client';

import { useEffect, useState } from 'react';
import type { ResponseOutcome } from '@outreach/shared-types';
import { Modal } from '../ui/modal';

export interface ResponseOutcomeConfirmPayload {
  reason?: string;
  newContactEmail?: string;
  newContactFirstName?: string;
  newContactLastName?: string;
  sendFirstStepImmediately?: boolean;
}

const OUTCOME_CONFIG: Record<
  ResponseOutcome,
  { label: string; explanation: string; scope: string; noteRequired: boolean }
> = {
  NOT_INTERESTED: {
    label: 'No interesado',
    explanation:
      'La empresa indica que no tiene interés. Se detienen los próximos envíos para todos sus contactos.',
    scope: 'Alcance: toda la empresa (todos sus contactos en esta secuencia).',
    noteRequired: false,
  },
  DO_NOT_CONTACT: {
    label: 'No contactar',
    explanation:
      'El contacto solicita no recibir más correos. Se detienen los envíos solamente para ese contacto.',
    scope: 'Alcance: solo este contacto.',
    noteRequired: true,
  },
  INTERESTED: {
    label: 'Interesado',
    explanation:
      'La empresa muestra interés. Se detiene la secuencia completa para continuar la gestión comercial.',
    scope: 'Alcance: toda la empresa (todos sus contactos en esta secuencia).',
    noteRequired: false,
  },
  REFERRED: {
    label: 'Deriva',
    explanation:
      'El contacto dirige la gestión a otra persona de la empresa. Se retira al contacto original y se permite incorporar al nuevo contacto.',
    scope: 'Alcance: se retira a este contacto y se incorpora al nuevo contacto que indiques.',
    noteRequired: false,
  },
};

/**
 * §2 — replaces `window.confirm`/`window.prompt` for the 4 "Resultado de la respuesta" actions.
 * Owns its own draft state (note + the "Deriva" new-contact fields) so it always starts blank
 * when opened, and resets itself when the outcome/pending state resolves.
 */
export function ResponseOutcomeModal({
  outcome,
  contactLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  outcome: ResponseOutcome | null;
  contactLabel: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (payload: ResponseOutcomeConfirmPayload) => void;
}) {
  const [note, setNote] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactFirstName, setNewContactFirstName] = useState('');
  const [newContactLastName, setNewContactLastName] = useState('');
  const [sendFirstStepImmediately, setSendFirstStepImmediately] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setNote('');
    setNewContactEmail('');
    setNewContactFirstName('');
    setNewContactLastName('');
    setSendFirstStepImmediately(true);
    setValidationError(null);
  }, [outcome]);

  if (!outcome) return null;
  const config = OUTCOME_CONFIG[outcome];

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (config.noteRequired && !note.trim()) {
      setValidationError('La nota interna es obligatoria para este resultado.');
      return;
    }
    if (outcome === 'REFERRED' && !newContactEmail.trim()) {
      setValidationError('Ingresa el correo del nuevo contacto.');
      return;
    }
    setValidationError(null);
    onConfirm({
      reason: note.trim() || undefined,
      ...(outcome === 'REFERRED'
        ? {
            newContactEmail: newContactEmail.trim(),
            newContactFirstName: newContactFirstName.trim() || undefined,
            newContactLastName: newContactLastName.trim() || undefined,
            sendFirstStepImmediately,
          }
        : {}),
    });
  }

  return (
    <Modal open onClose={onCancel} title={`Confirmar resultado: ${config.label}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Confirmar resultado: {config.label}</h3>
          <p className="mt-1 text-xs text-slate-500">Contacto: {contactLabel}</p>
        </div>

        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">{config.explanation}</p>
        <p className="text-xs font-medium text-slate-600">{config.scope}</p>

        {outcome === 'REFERRED' && (
          <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nuevo contacto</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={newContactFirstName}
                onChange={(event) => setNewContactFirstName(event.target.value)}
                placeholder="Nombre"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              />
              <input
                value={newContactLastName}
                onChange={(event) => setNewContactLastName(event.target.value)}
                placeholder="Apellido (opcional)"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              />
            </div>
            <input
              type="email"
              required
              value={newContactEmail}
              onChange={(event) => setNewContactEmail(event.target.value)}
              placeholder="Correo del nuevo contacto"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={sendFirstStepImmediately}
                onChange={(event) => setSendFirstStepImmediately(event.target.checked)}
                className="rounded border-slate-300"
              />
              Enviar &quot;Enviados_1&quot; de inmediato al nuevo contacto
            </label>
          </div>
        )}

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Nota interna{config.noteRequired ? '' : ' (opcional)'}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Ej: el contacto solicitó una reunión para revisar la propuesta…"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-normal text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>

        {(validationError || error) && (
          <p className="text-xs text-red-600">{validationError ?? error}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pending ? 'Guardando…' : 'Confirmar resultado'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
