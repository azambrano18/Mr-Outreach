'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { CreateUserResult, RoleSummary } from '@outreach/shared-types';
import { OneTimeCredentialsModal } from '../../../../components/executives/one-time-credentials-modal';

export function CreateExecutiveForm({ roles }: { roles: RoleSummary[] }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  // Defaults to the EXECUTIVE role when present — this form creates
  // executives; requiring an extra click to *not* grant ADMIN by default
  // is safer than the reverse.
  const defaultRole = roles.find((role) => role.name === 'EXECUTIVE') ?? roles[0];
  const [roleId, setRoleId] = useState(defaultRole?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; temporaryPassword: string } | null>(
    null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, roleId }),
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
          <select
            required
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        <p className="text-xs text-slate-500">
          La contraseña inicial se genera automáticamente y se mostrará una sola vez al confirmar.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
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
