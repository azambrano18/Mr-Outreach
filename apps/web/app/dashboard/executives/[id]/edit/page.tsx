import { notFound, redirect } from 'next/navigation';
import type { RoleSummary, UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { EditExecutiveForm } from './edit-executive-form';

export default async function EditExecutivePage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('users.update')) {
    redirect('/dashboard/executives');
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

  const roles = await apiFetch<RoleSummary[]>('/roles');

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Editar ejecutivo</h1>
      <EditExecutiveForm executive={executive} roles={roles} />
    </div>
  );
}
