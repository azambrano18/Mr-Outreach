import { notFound, redirect } from 'next/navigation';
import type { AssignedMailboxSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import type { SequenceExecutionSummary } from '../../../../lib/sequence-execution-types';
import type { SequenceTemplateSummary } from '../../../../lib/sequence-template-types';
import { SequenceExecutionDetail } from './sequence-execution-detail';

export default async function SequenceExecutionDetailPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_executions.read_own')) {
    return <AccessDenied />;
  }

  let execution: SequenceExecutionSummary;
  try {
    execution = await apiFetch<SequenceExecutionSummary>(`/me/sequence-executions/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  // §10 — only needed while DRAFT (to let the executive reassign account/plantilla), but harmless to fetch always.
  const [mailboxes, templates] = await Promise.all([
    apiFetch<AssignedMailboxSummary[]>('/me/mailboxes'),
    apiFetch<SequenceTemplateSummary[]>('/me/sequence-templates'),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 py-4">
      <SequenceExecutionDetail
        initialExecution={execution}
        canRefresh={currentUser.permissions.includes('sequence_executions.refresh_status_own')}
        refreshEndpoint={`/api/sequence-executions/${execution.id}/refresh-status`}
        canUpdate={currentUser.permissions.includes('sequence_executions.update_own')}
        canDelete={currentUser.permissions.includes('sequence_executions.delete_own')}
        mailboxes={mailboxes}
        templates={templates.filter((t) => t.status === 'PUBLISHED')}
      />
    </div>
  );
}
