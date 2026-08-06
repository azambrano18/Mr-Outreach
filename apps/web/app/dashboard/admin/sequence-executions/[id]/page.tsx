import { notFound, redirect } from 'next/navigation';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { AccessDenied } from '../../../access-denied';
import type { SequenceExecutionSummary } from '../../../../../lib/sequence-execution-types';
import { SequenceExecutionDetail } from '../../../sequence-executions/[id]/sequence-execution-detail';

/**
 * §23 — same detail component as the executive's own view; the data source and refresh
 * endpoint are admin-scoped, and "Control operativo de Gestiones" (pausar/reanudar/detener/
 * reiniciar) is additionally rendered here. Per-action visibility (pause/resume/stop/restart)
 * is NOT decided by this page — it comes back from the backend as `execution.controlCapabilities`
 * (GET /admin/sequence-executions/:id, computed from CONTROL_TRANSITIONS + the current user's
 * sequence_executions.{pause,resume,stop,restart}_all permissions) — never shown on the
 * executive's own page, whose read paths never receive the acting user's permission keys.
 */
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
