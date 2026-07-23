import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { MailboxInboxSummary, MailboxSummary, UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../../lib/api';
import { getCurrentUser } from '../../../../../../../lib/session';
import { AccessDenied } from '../../../../../access-denied';
import { InboxView } from '../../../../../../../components/inbox/inbox-view';

export default async function MailboxInboxPage({
  params,
}: {
  params: { id: string; mailboxId: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('mailboxes.read.all')) {
    return <AccessDenied />;
  }

  let executive: UserSummary;
  try {
    executive = await apiFetch<UserSummary>(`/users/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const assignedMailboxes = await apiFetch<MailboxSummary[]>(
    `/mailboxes?executiveId=${params.id}`,
  ).catch(() => []);
  const mailbox = assignedMailboxes.find((box) => box.id === params.mailboxId);
  if (!mailbox) {
    notFound();
  }

  let inbox: MailboxInboxSummary;
  try {
    inbox = await apiFetch<MailboxInboxSummary>(`/mailboxes/${mailbox.id}/inbox`);
  } catch {
    inbox = { status: 'ENGINE_UNAVAILABLE', threads: [] };
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-4">
      <div>
        <Link
          href={`/dashboard/executives/${params.id}`}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          ← Volver al perfil del ejecutivo
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{mailbox.email}</h1>
        <p className="text-sm text-slate-500">Bandeja de {executive.name}</p>
      </div>

      <InboxView
        mailboxId={mailbox.id}
        mailboxEmail={mailbox.email}
        executiveLabel={executive.name}
        initialInbox={inbox}
      />
    </div>
  );
}
