import { notFound, redirect } from 'next/navigation';
import type { VariableSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { EditVariableForm } from './edit-variable-form';

export default async function EditVariablePage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('variables.update')) {
    redirect('/dashboard/variables');
  }

  let variable: VariableSummary;
  try {
    variable = await apiFetch<VariableSummary>(`/variables/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Editar variable</h1>
      <EditVariableForm variable={variable} />
    </div>
  );
}
