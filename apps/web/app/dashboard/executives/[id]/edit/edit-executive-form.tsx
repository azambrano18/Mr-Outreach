'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { RoleSummary, UserSummary } from '@outreach/shared-types';
import { ToggleStatusButton } from '../../toggle-status-button';

export function EditExecutiveForm({
  executive,
  roles,
}: {
  executive: UserSummary;
  roles: RoleSummary[];
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(executive.firstName);
  const [lastName, setLastName] = useState(executive.lastName);
  const [email, setEmail] = useState(executive.email);
  const [roleId, setRoleId] = useState(executive.roleId);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/users/${executive.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, roleId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'No se pudo guardar los cambios.');
        return;
      }

      router.push('/dashboard/executives');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
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
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <span className="text-xs text-slate-500">Debe terminar en @mejoreferido.cl.</span>
      </label>

      <div className="flex flex-col gap-1 text-sm text-slate-700">
        Estado
        <div>
          <ToggleStatusButton userId={executive.id} active={executive.status === 'ACTIVE'} />
        </div>
      </div>

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

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
