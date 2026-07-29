'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { UserSummary } from '@outreach/shared-types';

type TokenStatus = 'ISSUED' | 'EXPIRED' | 'REVOKED' | 'REDEEMED';

interface IntrospectResult {
  valid: boolean;
  status: TokenStatus;
  expiresAt: string;
  mailbox: { serverMailboxId: string; email: string; displayName: string; status: string; canSend: boolean };
  domain: { serverDomainId: string; name: string };
  client: { serverClientId: string; crmClientId: number | null; name: string };
}

const STATUS_MESSAGES: Record<TokenStatus, string> = {
  ISSUED: '',
  EXPIRED: 'Este token venció. Solicita uno nuevo al servidor motor.',
  REVOKED: 'Este token fue revocado. Solicita uno nuevo al servidor motor.',
  REDEEMED: 'Este token ya fue utilizado. Solicita uno nuevo al servidor motor.',
};

const TECHNICAL_STATUS_LABEL: Record<string, string> = {
  CONNECTED: 'Conectada',
  DEGRADED: 'Degradada',
  DISCONNECTED: 'Desconectada',
  DISABLED: 'Deshabilitada',
  UNKNOWN: 'Desconocido',
};

/**
 * The single way to add a mailbox: paste a motor-issued token. The token is
 * kept in memory only (React state) for the duration of this flow — never
 * localStorage, never a query parameter, never logged. The backend/motor is
 * the sole source of truth for cliente/dominio/correo/estado: this component
 * never lets the admin edit them.
 */
export function LinkMailboxForm() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<IntrospectResult | null>(null);

  const [executives, setExecutives] = useState<UserSummary[]>([]);
  const [primaryExecutiveId, setPrimaryExecutiveId] = useState('');
  const [secondaryExecutiveIds, setSecondaryExecutiveIds] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  // Stable per successfully-validated token — reused verbatim on every retry of the same link attempt.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  function reset(): void {
    setToken('');
    setValidationError(null);
    setResult(null);
    setExecutives([]);
    setPrimaryExecutiveId('');
    setSecondaryExecutiveIds([]);
    setLinkError(null);
    setIdempotencyKey(null);
  }

  async function handleValidate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setValidationError(null);
    setResult(null);
    setValidating(true);
    try {
      const response = await fetch('/api/mailboxes/link-token/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setValidationError(body.error ?? 'No se pudo validar el token.');
        return;
      }
      const info = body as IntrospectResult;
      if (!info.valid) {
        setValidationError(STATUS_MESSAGES[info.status] ?? 'Este token no es válido.');
        return;
      }
      setResult(info);
      setIdempotencyKey(crypto.randomUUID());
      const usersResponse = await fetch('/api/users');
      const users: UserSummary[] = usersResponse.ok ? await usersResponse.json() : [];
      setExecutives(users.filter((u) => u.status === 'ACTIVE'));
    } catch {
      setValidationError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setValidating(false);
    }
  }

  function toggleSecondary(userId: string): void {
    setSecondaryExecutiveIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  const tokenStillValid = result ? !isExpired(result.expiresAt) : true;

  async function handleLink(): Promise<void> {
    if (!result || !primaryExecutiveId || !idempotencyKey || linking) return;
    setLinkError(null);
    setLinking(true);
    try {
      const response = await fetch('/api/mailboxes/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ token, primaryExecutiveId, secondaryExecutiveIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLinkError(body.error ?? 'No se pudo vincular la cuenta.');
        return;
      }
      setLinked(true);
      setToken('');
      setTimeout(() => {
        router.push('/dashboard/mailboxes');
        router.refresh();
      }, 900);
    } catch {
      setLinkError('No se pudo contactar la API. Intenta nuevamente.');
    } finally {
      setLinking(false);
    }
  }

  if (linked) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-sm font-medium text-emerald-800">Cuenta vinculada correctamente.</p>
        <p className="text-xs text-emerald-700">Redirigiendo al listado de cuentas…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!result && (
        <form onSubmit={handleValidate} className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
          <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="link-token">
            Token de vinculación
            <textarea
              id="link-token"
              required
              rows={3}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
              placeholder="Pega aquí el token entregado por el servidor motor"
            />
          </label>
          {validationError && <p className="text-sm text-red-600">{validationError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={validating || !token.trim()}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {validating ? 'Validando…' : 'Validar token'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/dashboard/mailboxes')}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {result && (
        <>
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
            <h2 className="text-sm font-medium text-slate-700">Información validada por el servidor motor</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Cliente</dt>
              <dd className="text-slate-900">{result.client.name}</dd>
              <dt className="text-slate-500">Dominio</dt>
              <dd className="text-slate-900">{result.domain.name}</dd>
              <dt className="text-slate-500">Correo</dt>
              <dd className="text-slate-900">{result.mailbox.email}</dd>
              <dt className="text-slate-500">Nombre visible</dt>
              <dd className="text-slate-900">{result.mailbox.displayName}</dd>
              <dt className="text-slate-500">Estado técnico</dt>
              <dd className="text-slate-900">{TECHNICAL_STATUS_LABEL[result.mailbox.status] ?? result.mailbox.status}</dd>
              <dt className="text-slate-500">Puede enviar</dt>
              <dd className={result.mailbox.canSend ? 'text-emerald-700' : 'text-red-600'}>
                {result.mailbox.canSend ? 'Sí' : 'No'}
              </dd>
              <dt className="text-slate-500">Vence</dt>
              <dd className="text-slate-900">{new Date(result.expiresAt).toLocaleString('es-CL')}</dd>
            </dl>
            <p className="text-xs text-slate-500">
              Estos datos son de solo lectura — provienen exclusivamente del servidor motor y no pueden editarse aquí.
            </p>
            {!tokenStillValid && (
              <p className="text-sm text-red-600">Este token venció mientras completabas el formulario. Vuelve a pegarlo.</p>
            )}
          </div>

          <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
            <legend className="px-1 text-sm font-medium text-slate-700">Ejecutivo principal (obligatorio)</legend>
            <select
              required
              value={primaryExecutiveId}
              onChange={(event) => {
                setPrimaryExecutiveId(event.target.value);
                setSecondaryExecutiveIds((current) => current.filter((id) => id !== event.target.value));
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Selecciona un ejecutivo</option>
              {executives.map((executive) => (
                <option key={executive.id} value={executive.id}>
                  {executive.name}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
            <legend className="px-1 text-sm font-medium text-slate-700">Ejecutivos secundarios (opcional)</legend>
            {executives.filter((e) => e.id !== primaryExecutiveId).length === 0 ? (
              <p className="text-xs text-slate-500">No hay otros ejecutivos disponibles.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {executives
                  .filter((executive) => executive.id !== primaryExecutiveId)
                  .map((executive) => (
                    <label key={executive.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={secondaryExecutiveIds.includes(executive.id)}
                        onChange={() => toggleSecondary(executive.id)}
                        className="rounded border-slate-300"
                      />
                      {executive.name}
                    </label>
                  ))}
              </div>
            )}
          </fieldset>

          {linkError && <p className="text-sm text-red-600">{linkError}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleLink}
              disabled={linking || !primaryExecutiveId || !tokenStillValid}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {linking ? 'Vinculando…' : 'Vincular cuenta'}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={linking}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}
