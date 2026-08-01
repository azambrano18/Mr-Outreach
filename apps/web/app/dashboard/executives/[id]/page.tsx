import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';
import { isProtectedSystemAccount } from '../../../../lib/protected-system-account';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import { DeleteUserButton } from '../delete-user-button';
import { ResetPasswordButton } from '../reset-password-button';
import { ToggleStatusButton } from '../toggle-status-button';
import { ExecutiveProfileSummary } from './executive-profile-summary';

/** Spec §6.1/§6.3 — Ejecutivos is access-administration only, no operational data (clients/mailboxes/sequences/activity/permissions). */
export default async function ExecutiveProfilePage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('users.read')) {
    return <AccessDenied />;
  }

  let executive: UserSummary;
  try {
    executive = await apiFetch<UserSummary>(`/users/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const canUpdate = currentUser.permissions.includes('users.update');
  const canDisable = currentUser.permissions.includes('users.disable');
  const canResetPassword = currentUser.permissions.includes('users.reset_password');
  // Available for both ADMIN and EXECUTIVE users now — never for the protected
  // system account or for one's own account. Both exclusions are cosmetic
  // here; the backend (UsersService.remove) rejects them independently.
  const canDelete =
    currentUser.permissions.includes('users.delete') &&
    !isProtectedSystemAccount(executive.email) &&
    executive.id !== currentUser.id;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{executive.name}</h1>
          <p className="text-sm text-slate-500">{executive.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpdate && (
            <Link
              href={`/dashboard/executives/${executive.id}/edit`}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              Editar ejecutivo
            </Link>
          )}
          {canDisable && (
            <ToggleStatusButton userId={executive.id} active={executive.status === 'ACTIVE'} />
          )}
          {canResetPassword && <ResetPasswordButton userId={executive.id} />}
          {canDelete && (
            <DeleteUserButton
              userId={executive.id}
              name={executive.name}
              email={executive.email}
              roleName={executive.roleName}
            />
          )}
        </div>
      </div>

      <ExecutiveProfileSummary executive={executive} />
    </div>
  );
}
