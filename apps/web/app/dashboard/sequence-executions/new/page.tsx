import { redirect } from 'next/navigation';
import type { AssignedMailboxSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import type { SequenceTemplateSummary } from '../../../../lib/sequence-template-types';
import { NewSequenceExecutionWizard } from './new-sequence-execution-wizard';

export default async function NewSequenceExecutionPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_executions.create_own')) {
    return <AccessDenied />;
  }

  const [mailboxes, templates] = await Promise.all([
    apiFetch<AssignedMailboxSummary[]>('/me/mailboxes'),
    apiFetch<SequenceTemplateSummary[]>('/me/sequence-templates'),
  ]);

  const publishedTemplates = templates.filter((t) => t.status === 'PUBLISHED');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Nueva gestión</h1>
        <p className="text-sm text-slate-500">
          Selecciona la cuenta, la plantilla publicada y carga tu base de prospectos.
        </p>
      </div>
      <NewSequenceExecutionWizard mailboxes={mailboxes} templates={publishedTemplates} />
    </div>
  );
}
