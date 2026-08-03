import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';
import { getExecutiveActionsVisibility } from '../../../../lib/executive-action-visibility';
import { getCurrentUser } from '../../../../lib/session';
import { parseUserStatus } from '../../../../lib/user-status';
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
  const canResetPassword = currentUser.permissions.includes('users.reset_password');

  // Runtime boundary check — `UserSummary.status` being typed
  // `'ACTIVE' | 'INACTIVE'` at compile time proves nothing about what the
  // API actually sent (a stale deploy, a serialization bug, or a future
  // third status would all satisfy the type while being something else in
  // practice). Never logs the executive's name/email — only the id and
  // the literal unexpected value, neither of which is sensitive.
  if (parseUserStatus(executive.status) === null) {
    console.warn(
      `[executives] Unexpected user.status for executive detail: userId=${executive.id} status=${JSON.stringify(executive.status)}`,
    );
  }

  // Single source of truth for the Activar/Desactivar/Eliminar gating —
  // see getExecutiveActionsVisibility's own comment for why every action
  // is derived from two INDEPENDENT, explicit checks (`status ===
  // 'ACTIVE'` / `status === 'INACTIVE'`), never from one negating the
  // other. That exact `!isActive` shortcut previously let "Activar" show
  // while "Eliminar" silently never did, and would let any unrecognized
  // status value enable Eliminar too. All exclusions (protected account,
  // self, unknown/still-ACTIVE status) are cosmetic here; the backend
  // (UsersService.remove/setStatus) rejects them independently regardless
  // of what this computes.
  const visibility = getExecutiveActionsVisibility(executive, currentUser);

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
          {(visibility.showDeactivate || visibility.showActivate) && (
            <ToggleStatusButton userId={executive.id} active={visibility.showDeactivate} />
          )}
          {canResetPassword && <ResetPasswordButton userId={executive.id} />}
          {visibility.showDelete && (
            <DeleteUserButton
              userId={executive.id}
              name={executive.name}
              email={executive.email}
              roleName={executive.roleName}
              status={executive.status}
            />
          )}
        </div>
      </div>

      <ExecutiveProfileSummary executive={executive} />
    </div>
  );
}
