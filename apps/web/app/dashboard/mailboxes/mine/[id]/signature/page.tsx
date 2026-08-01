import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { AssignedMailboxSummary, SignatureSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';
import { getCurrentUser } from '../../../../../../lib/session';
import { MailboxSignatureEditor } from './mailbox-signature-editor';

/**
 * Fase 2 (R2) — a mailbox has exactly one signature, shared by every one of
 * its Plantillas (see SequenceTemplatesService.getSignatureHtmlForMailbox).
 * This is the only screen where it's actually editable; the Plantilla
 * editor only shows a read-only preview with a link back here.
 */
export default async function MailboxSignaturePage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('signatures.read')) {
    redirect('/dashboard/mailboxes/mine');
  }

  // Same ownership scoping as the settings page: only proceed when this
  // mailbox actually shows up in /me/mailboxes.
  const myMailboxes = await apiFetch<AssignedMailboxSummary[]>('/me/mailboxes');
  const mailbox = myMailboxes.find((candidate) => candidate.id === params.id);
  if (!mailbox) {
    notFound();
  }

  let signature: SignatureSummary | null = null;
  try {
    signature = await apiFetch<SignatureSummary>(`/me/mailboxes/${params.id}/signature`);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) {
      throw error;
    }
  }

  const canUpdate = currentUser.permissions.includes('signatures.update');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-4">
      <div>
        <Link href={`/dashboard/mailboxes/mine/${params.id}/settings`} className="text-xs font-medium text-brand-700 hover:underline">
          ← Volver a la configuración de la cuenta
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Firma de {mailbox.name}</h1>
        <p className="text-sm text-slate-500">{mailbox.email}</p>
      </div>

      <MailboxSignatureEditor
        mailboxId={params.id}
        initialHtml={signature?.activeVersion?.htmlContent ?? ''}
        canUpdate={canUpdate}
      />
    </div>
  );
}
