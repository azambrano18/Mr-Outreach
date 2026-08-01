'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { CreateUserResult, RoleSummary } from '@outreach/shared-types';
import { OneTimeCredentialsModal } from '../../../../components/executives/one-time-credentials-modal';

const EXECUTIVE_ROLE_FRIENDLY_LABEL = 'Ejecutivo';
const EXECUTIVE_ROLE_MISCONFIGURED_MESSAGE =
  'El rol Ejecutivo no está configurado para esta organización. Sincroniza los roles del sistema antes de crear usuarios.';

/**
 * This form only ever creates EXECUTIVE users. There is no role selector —
 * the role is resolved once by the server component (new/page.tsx), which
 * looks it up by name rather than defaulting to whatever the API happens
 * to return first. If the EXECUTIVE role isn't configured for this
 * organization, `executiveRole` is null and submission is disabled — never
 * fall back to any other role (in particular, never ADMIN).
 */
export function CreateExecutiveForm({ executiveRole }: { executiveRole: RoleSummary | null }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; temporaryPassword: string } | null>(
    null,
  );

  const roleMisconfigured = !executiveRole;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!executiveRole) {
      // Defense in depth — the submit button is already disabled in this state.
      setError(EXECUTIVE_ROLE_MISCONFIGURED_MESSAGE);
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, roleId: executiveRole.id }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo crear el ejecutivo.');
        return;
      }

      const created = body as CreateUserResult;
      setCreatedCredentials({ email: created.email, temporaryPassword: created.temporaryPassword });
    } finally {
      setLoading(false);
    }
  }

  function handleCloseCredentials(): void {
    setCreatedCredentials(null);
    router.push('/dashboard/executives');
    router.refresh();
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5"
      >
        {roleMisconfigured && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {EXECUTIVE_ROLE_MISCONFIGURED_MESSAGE}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Nombre
            <input
              required
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Apellido
            <input
              required
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Correo institucional
          <input
            type="email"
            required
            placeholder="nombre.apellido@mejoreferido.cl"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
          <span className="text-xs text-slate-500">Debe terminar en @mejoreferido.cl.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Rol
          <input
            value={EXECUTIVE_ROLE_FRIENDLY_LABEL}
            disabled
            readOnly
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
          />
          <span className="text-xs text-slate-500">
            Este formulario crea exclusivamente cuentas de Ejecutivo.
          </span>
        </label>

        <p className="text-xs text-slate-500">
          La contraseña inicial se genera automáticamente y se mostrará una sola vez al confirmar.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || roleMisconfigured}
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Creando…' : 'Crear ejecutivo'}
          </button>
        </div>
      </form>

      {createdCredentials && (
        <OneTimeCredentialsModal
          open
          onClose={handleCloseCredentials}
          email={createdCredentials.email}
          temporaryPassword={createdCredentials.temporaryPassword}
        />
      )}
    </>
  );
}
