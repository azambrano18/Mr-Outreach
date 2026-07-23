import Link from 'next/link';
import { Settings } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import type { DomainSummary, MailboxSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../../../lib/api';
import { getCurrentUser } from '../../../../../../lib/session';

const CONNECTION_LABEL: Record<MailboxSummary['connectionStatus'], string> = {
  NOT_TESTED: 'Sin probar',
  TESTING: 'Probando…',
  CONNECTED: 'Conectada',
  PARTIALLY_CONNECTED: 'Conexión parcial',
  CONNECTION_ERROR: 'Error de conexión',
  ENGINE_UNAVAILABLE: 'Motor no disponible',
};

export default async function DomainDetailPage({
  params,
}: {
  params: { clientId: string; domainId: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  const canReadAll =
    currentUser.permissions.includes('domains.read') &&
    currentUser.permissions.includes('mailboxes.read.all');
  const domainBase = canReadAll ? '/domains' : '/me/domains';
  const mine = !canReadAll;
  const canCreateMailbox = currentUser.permissions.includes('mailboxes.create');

  let domain: DomainSummary;
  let mailboxes: MailboxSummary[] = [];
  try {
    [domain, mailboxes] = await Promise.all([
      apiFetch<DomainSummary>(`${domainBase}/${params.domainId}`),
      apiFetch<MailboxSummary[]>(`${domainBase}/${params.domainId}/mailboxes`),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/clients/${params.clientId}`}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          ← {domain.clientName}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{domain.domainName}</h1>
        <p className="text-sm text-slate-500">
          Cliente: {domain.clientName} · {mailboxes.length} cuenta
          {mailboxes.length === 1 ? '' : 's'}
        </p>
      </div>

      <Link
        href={`/dashboard/clients/${params.clientId}/conversations`}
        className="inline-flex w-fit items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
      >
        Todas las conversaciones del dominio
        {domain.pendingConversationCount > 0 && (
          <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
            {domain.pendingConversationCount}
          </span>
        )}
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Cuentas de correo
          </h2>
          {canCreateMailbox && (
            <Link
              href={`/dashboard/mailboxes/new?domainId=${domain.id}&clientId=${params.clientId}`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
            >
              Registrar cuenta de correo
            </Link>
          )}
        </div>
        {mailboxes.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">
            Este dominio todavía no tiene cuentas de correo vinculadas
            {mine ? ' asignadas a ti' : ''}.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {mailboxes.map((mailbox) => (
              <li
                key={mailbox.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
              >
                <Link
                  href={`/dashboard/clients/${params.clientId}/conversations?mailboxId=${mailbox.id}`}
                  className="flex min-w-0 flex-1 flex-col gap-1"
                >
                  <span className="truncate text-base font-semibold text-slate-900">
                    {mailbox.name}
                  </span>
                  <span className="truncate text-xs text-slate-500">{mailbox.email}</span>
                  <span className="text-xs text-slate-500">
                    {mailbox.status === 'ACTIVE' ? 'Operativa' : 'Inactiva'} ·{' '}
                    {CONNECTION_LABEL[mailbox.connectionStatus]}
                  </span>
                </Link>
                <Link
                  href={
                    mine
                      ? `/dashboard/mailboxes/mine/${mailbox.id}/settings`
                      : `/dashboard/mailboxes/${mailbox.id}/edit`
                  }
                  aria-label="Configurar cuenta de correo"
                  title="Configurar cuenta"
                  className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-300 p-2 text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700"
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
