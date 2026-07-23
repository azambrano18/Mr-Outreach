import { notFound, redirect } from 'next/navigation';
import type { TemplateSummary, VariableSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { EditTemplateForm } from './edit-template-form';

export default async function EditTemplatePage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('templates.update')) {
    redirect('/dashboard/templates');
  }

  let template: TemplateSummary;
  try {
    template = await apiFetch<TemplateSummary>(`/templates/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  let availableVariables: VariableSummary[] = [];
  if (currentUser.permissions.includes('variables.read')) {
    try {
      const variables = await apiFetch<VariableSummary[]>('/variables');
      availableVariables = variables.filter((variable) => variable.status === 'ACTIVE');
    } catch {
      availableVariables = [];
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Editar texto</h1>
      <EditTemplateForm template={template} availableVariables={availableVariables} />
    </div>
  );
}
