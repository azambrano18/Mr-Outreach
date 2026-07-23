import { notFound, redirect } from 'next/navigation';
import type { AdminSequenceDetail, ClientAssigneeSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { AccessDenied } from '../../../access-denied';
import { AdminSequenceDetailTabs } from './admin-sequence-detail-tabs';

export const dynamic = 'force-dynamic';

export default async function AdminSequenceDetailPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('sequences.read_all')) {
    return <AccessDenied />;
  }

  let detail: AdminSequenceDetail;
  try {
    detail = await apiFetch<AdminSequenceDetail>(`/sequences/${params.id}/monitor`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  let assignableExecutives: ClientAssigneeSummary[] = [];
  if (detail.clientId) {
    assignableExecutives = await apiFetch<ClientAssigneeSummary[]>(`/clients/${detail.clientId}/assignees`).catch(
      () => [],
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{detail.name}</h1>
        <p className="text-sm text-slate-500">
          {detail.clientName ?? 'Sin cliente'} · {detail.mailboxEmail ?? 'Sin cuenta'}
        </p>
      </div>
      <AdminSequenceDetailTabs
        detail={detail}
        assignableExecutives={assignableExecutives.filter((e) => e.status === 'ACTIVE')}
        canReassign={currentUser.permissions.includes('sequences.reassign')}
        canPause={currentUser.permissions.includes('sequences.pause')}
        canArchive={currentUser.permissions.includes('sequences.archive')}
        canCancel={currentUser.permissions.includes('sequences.cancel')}
        canRemoveProspects={currentUser.permissions.includes('sequences.prospects.remove')}
      />
    </div>
  );
}
