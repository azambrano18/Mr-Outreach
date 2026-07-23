import { notFound, redirect } from 'next/navigation';
import type { MailboxConnectionTestSummary, MailboxSummary, SignatureSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { ConnectionTestHistory } from './connection-test-history';
import { EditMailboxForm } from './edit-mailbox-form';
import { SignatureSection } from '../../../../../components/mailboxes/signature-section';

export default async function EditMailboxPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('mailboxes.update')) {
    redirect('/dashboard/clients');
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

  let history: MailboxConnectionTestSummary[] = [];
  if (currentUser.permissions.includes('mailboxes.read.all')) {
    try {
      history = await apiFetch<MailboxConnectionTestSummary[]>(
        `/mailboxes/${params.id}/connection-tests`,
      );
    } catch {
      history = [];
    }
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-4">
      <h1 className="text-2xl font-semibold text-slate-900">Editar cuenta de correo</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">General</h2>
        <EditMailboxForm mailbox={mailbox} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Conexión</h2>
        <ConnectionTestHistory history={history} />
      </section>

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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Estado y diagnóstico
        </h2>
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Estado general
            </span>
            <p className="text-sm text-slate-800">
              {mailbox.status === 'ACTIVE' ? 'Operativa' : 'Inactiva'}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              IMAP / SMTP
            </span>
            <p className="text-sm text-slate-800">{mailbox.connectionStatus}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Firma
            </span>
            <p className="text-sm text-slate-800">
              {signature?.activeVersion ? 'Configurada' : 'No configurada'}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Capacidad disponible
            </span>
            <p className="text-sm text-slate-800">No disponible en esta fase</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Último error
            </span>
            <p className="text-sm text-slate-800">
              {mailbox.lastTestMessage ?? 'Sin errores recientes'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
