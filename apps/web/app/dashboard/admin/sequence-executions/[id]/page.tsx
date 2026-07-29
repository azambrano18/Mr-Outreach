import { notFound, redirect } from 'next/navigation';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { AccessDenied } from '../../../access-denied';
import type { SequenceExecutionSummary } from '../../../../../lib/sequence-execution-types';
import { SequenceExecutionDetail } from '../../../sequence-executions/[id]/sequence-execution-detail';

/** §23 — same read-only detail component as the executive's own view; only the data source and refresh endpoint are admin-scoped. */
export default async function AdminSequenceExecutionDetailPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_executions.monitor_all')) {
    return <AccessDenied />;
  }

  let execution: SequenceExecutionSummary;
  try {
    execution = await apiFetch<SequenceExecutionSummary>(`/admin/sequence-executions/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 py-4">
      <SequenceExecutionDetail
        initialExecution={execution}
        canRefresh={currentUser.permissions.includes('sequence_executions.refresh_status_all')}
        refreshEndpoint={`/api/admin/sequence-executions/${execution.id}/refresh-status`}
        canSimulate={currentUser.permissions.includes('dev_tools.simulate_execution_state')}
      />
    </div>
  );
}
