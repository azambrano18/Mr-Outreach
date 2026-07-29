import { notFound, redirect } from 'next/navigation';
import type { MailboxSummary, SignatureSummary, UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { LegacyMailboxPanel } from './legacy-mailbox-panel';
import { ServerLinkedMailboxPanel } from './server-linked-mailbox-panel';
import { SignatureSection } from '../../../../../components/mailboxes/signature-section';

export default async function EditMailboxPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('mailboxes.update')) {
    redirect('/dashboard/mailboxes');
  }

  let mailbox: MailboxSummary;
  try {
    mailbox = await apiFetch<MailboxSummary>(`/mailboxes/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  let signature: SignatureSummary | null = null;
  const canReadSignature = currentUser.permissions.includes('signatures.read');
  if (canReadSignature) {
    try {
      signature = await apiFetch<SignatureSummary>(`/mailboxes/${params.id}/signature`);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        throw error;
      }
      signature = null;
    }
  }

  let executives: UserSummary[] = [];
  if (currentUser.permissions.includes('mailboxes.assign')) {
    try {
      executives = (await apiFetch<UserSummary[]>('/users')).filter((u) => u.status === 'ACTIVE');
    } catch {
      executives = [];
    }
  }

  // Fase 2.1, §17 — a SERVER_TOKEN mailbox gets its own screen: no IMAP/SMTP
  // fields, no "Probar conexión". A LEGACY_LOCAL account gets a minimal,
  // read-mostly panel (§9 of the interface cleanup) — Mr Outreach no longer
  // allows creating or editing manual credentials for either kind.
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-4">
      <h1 className="text-2xl font-semibold text-slate-900">
        {mailbox.linkSource === 'SERVER_TOKEN' ? 'Cuenta vinculada por token' : 'Cuenta heredada'}
      </h1>

      {mailbox.linkSource === 'SERVER_TOKEN' ? (
        <ServerLinkedMailboxPanel
          mailbox={mailbox}
          executives={executives}
          canReassign={currentUser.permissions.includes('mailboxes.assign')}
          canUnlink={currentUser.permissions.includes('mailboxes.unlink')}
          canViewAudit={currentUser.permissions.includes('audit.read')}
        />
      ) : (
        <LegacyMailboxPanel
          mailbox={mailbox}
          executives={executives}
          canReassign={currentUser.permissions.includes('mailboxes.assign')}
        />
      )}

      {canReadSignature && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Firma</h2>
          <SignatureSection
            mailboxId={mailbox.id}
            initialSignature={signature}
            canCreate={currentUser.permissions.includes('signatures.create')}
            canUpdate={currentUser.permissions.includes('signatures.update')}
            canActivate={currentUser.permissions.includes('signatures.activate')}
            canArchive={currentUser.permissions.includes('signatures.archive')}
            canPreview={currentUser.permissions.includes('signatures.preview')}
            canTest={currentUser.permissions.includes('signatures.test')}
          />
        </section>
      )}
    </div>
  );
}
