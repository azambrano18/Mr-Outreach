import { redirect } from 'next/navigation';
import type { RoleSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { CreateExecutiveForm } from './create-executive-form';

export default async function NewExecutivePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('users.create')) {
    redirect('/dashboard/executives');
  }

  const roles = await apiFetch<RoleSummary[]>('/roles');

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Crear ejecutivo</h1>
      <CreateExecutiveForm roles={roles} />
    </div>
  );
}
