import { redirect } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import type { SequenceExecutionSummary } from '../../../../lib/sequence-execution-types';
import { AdminSequenceExecutionsList } from './admin-sequence-executions-list';

/**
 * §13/§14 — read-only. No "Nueva gestión" button, no edit affordances
 * anywhere on this page. The server administers its own processing
 * internally.
 */
export default async function AdminSequenceExecutionsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_executions.monitor_all')) {
    return <AccessDenied />;
  }

  const executions = await apiFetch<SequenceExecutionSummary[]>('/admin/sequence-executions');

  return <AdminSequenceExecutionsList executions={executions} />;
}
