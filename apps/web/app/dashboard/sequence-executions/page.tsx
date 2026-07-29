import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import type { SequenceExecutionSummary } from '../../../lib/sequence-execution-types';
import { SequenceExecutionsList } from './sequence-executions-list';

export default async function SequenceExecutionsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_executions.read_own')) {
    return <AccessDenied />;
  }

  const executions = await apiFetch<SequenceExecutionSummary[]>('/me/sequence-executions');

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Gestiones</h1>
          <p className="text-sm text-slate-500">Ejecuciones concretas de tus plantillas publicadas.</p>
        </div>
        {currentUser.permissions.includes('sequence_executions.create_own') && (
          <Link
            href="/dashboard/sequence-executions/new"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Nueva gestión
          </Link>
        )}
      </div>

      <SequenceExecutionsList executions={executions} />
    </div>
  );
}
