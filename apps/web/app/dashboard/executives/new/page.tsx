import { redirect } from 'next/navigation';
import type { RoleSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { CreateUserForm } from './create-user-form';

const ADMIN_ROLE_NAME = 'ADMIN';
const EXECUTIVE_ROLE_NAME = 'EXECUTIVE';

export default async function NewUserPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('users.create')) {
    redirect('/dashboard/executives');
  }

  const roles = await apiFetch<RoleSummary[]>('/roles');
  // Resolved explicitly by name — never roles[0], never any role besides
  // these two system roles. Each is independently nullable: the form must
  // fail closed per-role, not assume both exist just because one does.
  const adminRole = roles.find((role) => role.name === ADMIN_ROLE_NAME) ?? null;
  const executiveRole = roles.find((role) => role.name === EXECUTIVE_ROLE_NAME) ?? null;

  if (!adminRole || !executiveRole) {
    // Server-side only; never exposes user data, just enough to find this in the logs.
    console.error(
      `[executives/new] Missing system role(s) for organization ${currentUser.organizationId}: ${
        [!adminRole && ADMIN_ROLE_NAME, !executiveRole && EXECUTIVE_ROLE_NAME].filter(Boolean).join(', ')
      }. Run the system roles sync before creating users.`,
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Crear usuario</h1>
      <CreateUserForm adminRole={adminRole} executiveRole={executiveRole} />
    </div>
  );
}
