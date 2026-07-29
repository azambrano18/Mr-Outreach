import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { DomainSummary, ManagedClientSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';

const STATUS_LABEL: Record<DomainSummary['status'], string> = {
  ACTIVE: 'Operativo',
  INACTIVE: 'Inactivo',
  ARCHIVED: 'Archivado',
};

/**
 * Solo lectura — cliente y dominio son proyecciones derivadas de las
 * cuentas vinculadas por token, sin administración manual desde Mr
 * Outreach (§7/§8 de la limpieza de interfaz).
 */
export default async function ClientDetailPage({ params }: { params: { clientId: string } }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  let client: ManagedClientSummary;
  let domains: DomainSummary[] = [];
  try {
    [client, domains] = await Promise.all([
      apiFetch<ManagedClientSummary>(`/me/clients/${params.clientId}`),
      apiFetch<DomainSummary[]>(`/me/clients/${params.clientId}/domains`),
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
        <Link href="/dashboard/clients" className="text-xs font-medium text-brand-700 hover:underline">
          ← Clientes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{client.name}</h1>
        <p className="text-sm text-slate-500">
          {client.domainCount} dominio{client.domainCount === 1 ? '' : 's'} · {client.mailboxCount} cuenta
          {client.mailboxCount === 1 ? '' : 's'} · {client.sequenceCount} secuencia
          {client.sequenceCount === 1 ? '' : 's'}
        </p>
      </div>

      <Link
        href={`/dashboard/clients/${client.id}/conversations`}
        className="inline-flex w-fit items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
      >
        Todas las conversaciones del cliente
        {client.pendingConversationCount > 0 && (
          <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
            {client.pendingConversationCount}
          </span>
        )}
      </Link>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Dominios</h2>
        {domains.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">
            Este cliente todavía no tiene dominios registrados.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {domains.map((domain) => (
              <li
                key={domain.id}
                className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold text-slate-900">{domain.domainName}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      domain.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {STATUS_LABEL[domain.status]}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {domain.mailboxCount} cuenta{domain.mailboxCount === 1 ? '' : 's'} ·{' '}
                  {domain.pendingConversationCount} conversacion
                  {domain.pendingConversationCount === 1 ? '' : 'es'} pendiente
                  {domain.pendingConversationCount === 1 ? '' : 's'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
