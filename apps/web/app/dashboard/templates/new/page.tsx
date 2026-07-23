import { redirect } from 'next/navigation';
import type { VariableSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { CreateTemplateForm } from './create-template-form';

export default async function NewTemplatePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('templates.create')) {
    redirect('/dashboard/templates');
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
      <h1 className="text-2xl font-semibold text-slate-900">Nuevo texto</h1>
      <CreateTemplateForm availableVariables={availableVariables} />
    </div>
  );
}
