'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { CreateUserResult, RoleSummary } from '@outreach/shared-types';
import { OneTimeCredentialsModal } from '../../../../components/executives/one-time-credentials-modal';

const ADMIN_ROLE_NAME = 'ADMIN';
const EXECUTIVE_ROLE_NAME = 'EXECUTIVE';

const ROLE_FRIENDLY_LABEL: Record<string, string> = {
  [ADMIN_ROLE_NAME]: 'Administrador',
  [EXECUTIVE_ROLE_NAME]: 'Ejecutivo',
};

function misconfiguredMessage(roleName: string): string {
  return `El rol ${ROLE_FRIENDLY_LABEL[roleName]} no está configurado para esta organización. Sincroniza los roles del sistema antes de crear usuarios.`;
}

/**
 * Creates either an ADMIN or an EXECUTIVE user — never any other role.
 * Each role is resolved once by the server component (new/page.tsx) by
 * name, never by array position; if either is missing from this
 * organization, selecting it here is disabled rather than silently
 * falling back to whichever role happens to exist.
 */
export function CreateUserForm({
  adminRole,
  executiveRole,
}: {
  adminRole: RoleSummary | null;
  executiveRole: RoleSummary | null;
}) {
  const router = useRouter();
  const [selectedRoleName, setSelectedRoleName] = useState<string>(
    executiveRole ? EXECUTIVE_ROLE_NAME : ADMIN_ROLE_NAME,
  );
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdUser, setCreatedUser] = useState<CreateUserResult | null>(null);

  const selectedRole = selectedRoleName === ADMIN_ROLE_NAME ? adminRole : executiveRole;
  const noRoleAvailable = !adminRole && !executiveRole;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedRole) {
      // Defense in depth — the submit button is already disabled in this state.
      setError(misconfiguredMessage(selectedRoleName));
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, roleId: selectedRole.id }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'No se pudo crear el usuario.');
        return;
      }

      setCreatedUser(body as CreateUserResult);
    } finally {
      setLoading(false);
    }
  }

  function handleCloseCredentials(): void {
    setCreatedUser(null);
    router.push('/dashboard/executives');
    router.refresh();
  }

  const roleLabelForSelection = ROLE_FRIENDLY_LABEL[selectedRoleName] ?? selectedRoleName;

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5"
      >
        {noRoleAvailable && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Ni el rol Administrador ni el rol Ejecutivo están configurados para esta organización. Sincroniza los
            roles del sistema antes de crear usuarios.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm text-slate-700" htmlFor="user-role">
          Rol
          <select
            id="user-role"
            required
            value={selectedRoleName}
            onChange={(event) => setSelectedRoleName(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value={ADMIN_ROLE_NAME} disabled={!adminRole}>
              Administrador{!adminRole ? ' (no disponible)' : ''}
            </option>
            <option value={EXECUTIVE_ROLE_NAME} disabled={!executiveRole}>
              Ejecutivo{!executiveRole ? ' (no disponible)' : ''}
            </option>
          </select>
          {!selectedRole && <span className="text-xs text-red-600">{misconfiguredMessage(selectedRoleName)}</span>}
        </label>

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

        <p className="text-xs text-slate-500">
          La contraseña inicial se genera automáticamente y se mostrará una sola vez al confirmar.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || !selectedRole}
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Creando…' : `Crear ${roleLabelForSelection.toLowerCase()}`}
          </button>
        </div>
      </form>

      {createdUser && (
        <OneTimeCredentialsModal
          open
          onClose={handleCloseCredentials}
          email={createdUser.email}
          temporaryPassword={createdUser.temporaryPassword}
          roleLabel={ROLE_FRIENDLY_LABEL[createdUser.roleName] ?? createdUser.roleName}
        />
      )}
    </>
  );
}
