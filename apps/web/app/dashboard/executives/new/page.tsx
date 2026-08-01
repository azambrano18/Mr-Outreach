import { redirect } from 'next/navigation';
import type { RoleSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { CreateExecutiveForm } from './create-executive-form';

const EXECUTIVE_ROLE_NAME = 'EXECUTIVE';

export default async function NewExecutivePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('users.create')) {
    redirect('/dashboard/executives');
  }

  const roles = await apiFetch<RoleSummary[]>('/roles');
  // Resolved explicitly by name — never roles[0]. If EXECUTIVE isn't
  // configured for this organization, executiveRole is null and the form
  // renders in a fail-closed state (submission disabled, no fallback to
  // any other role, in particular never ADMIN).
  const executiveRole = roles.find((role) => role.name === EXECUTIVE_ROLE_NAME) ?? null;

  if (!executiveRole) {
    // Server-side only; never exposes user data, just enough to find this in the logs.
    console.error(
      `[executives/new] EXECUTIVE role not found for organization ${currentUser.organizationId}. Run the system roles sync before creating executives.`,
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Crear ejecutivo</h1>
      <CreateExecutiveForm executiveRole={executiveRole} />
    </div>
  );
}
