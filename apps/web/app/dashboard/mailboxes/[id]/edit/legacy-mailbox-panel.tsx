'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MailboxSummary, UserSummary } from '@outreach/shared-types';
import { MailboxToggleStatusButton } from './mailbox-toggle-status-button';

/**
 * Cuenta heredada (LEGACY_LOCAL) — configurada antes de esta fase. Mr
 * Outreach ya no permite crear ni editar credenciales IMAP/SMTP desde la
 * interfaz (§9 de la limpieza administrativa); esta pantalla solo permite
 * lo que sigue siendo una operación legítima: reasignar el ejecutivo
 * principal y activar/desactivar la cuenta.
 */
export function LegacyMailboxPanel({
  mailbox,
  executives,
  canReassign,
}: {
  mailbox: MailboxSummary;
  executives: UserSummary[];
  canReassign: boolean;
}) {
  const router = useRouter();
  const [primaryExecutiveId, setPrimaryExecutiveId] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignIdempotencyKey] = useState(() => crypto.randomUUID());

  async function handleReassign(): Promise<void> {
    if (!primaryExecutiveId) return;
    setReassignError(null);
    setReassigning(true);
    try {
      const response = await fetch(`/api/mailboxes/${mailbox.id}/primary-executive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': reassignIdempotencyKey },
        body: JSON.stringify({ newPrimaryExecutiveId: primaryExecutiveId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setReassignError(body.error ?? 'No se pudo reasignar el ejecutivo.');
        return;
      }
      router.refresh();
    } catch {
      setReassignError('No se pudo contactar la API.');
    } finally {
      setReassigning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Cuenta heredada — configurada antes de la vinculación por token. Su configuración técnica
        (servidor, puerto, cifrado, credenciales) ya no es editable desde Mr Outreach.
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Cliente</span>
          <p className="text-sm text-slate-800">{mailbox.clientName ?? '— Sin clasificar —'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Dominio</span>
          <p className="text-sm text-slate-800">{mailbox.domainName ?? '—'}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Correo</span>
          <p className="text-sm text-slate-800">{mailbox.email}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Nombre visible</span>
          <p className="text-sm text-slate-800">{mailbox.fromName}</p>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado local</span>
          <p className="text-sm text-slate-800">{mailbox.status === 'ACTIVE' ? 'Activa' : 'Inactiva'}</p>
        </div>
      </div>

      {canReassign && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Reasignar ejecutivo principal</legend>
          <select
            value={primaryExecutiveId}
            onChange={(event) => setPrimaryExecutiveId(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Selecciona un ejecutivo</option>
            {executives.map((executive) => (
              <option key={executive.id} value={executive.id}>
                {executive.name}
              </option>
            ))}
          </select>
          {reassignError && <p className="text-sm text-red-600">{reassignError}</p>}
          <button
            type="button"
            onClick={handleReassign}
            disabled={reassigning || !primaryExecutiveId}
            className="self-start rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {reassigning ? 'Reasignando…' : 'Reasignar'}
          </button>
        </fieldset>
      )}

      <div className="border-t border-slate-100 pt-4">
        <MailboxToggleStatusButton mailboxId={mailbox.id} active={mailbox.status === 'ACTIVE'} />
      </div>
    </div>
  );
}
