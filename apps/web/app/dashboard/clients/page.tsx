import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { AdminClientsListResult, ClientConfigurationStatus, ManagedClientSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { ConfigureClientButton } from '../../../components/clients/configure-client-button';

const STATUS_LABEL: Record<ManagedClientSummary['status'], string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  SUSPENDED: 'Suspendido',
  ARCHIVED: 'Archivado',
};

const CONFIGURATION_LABEL: Record<ClientConfigurationStatus, string> = {
  SIN_CONFIGURAR: 'Sin configurar',
  CONFIGURACION_INCOMPLETA: 'Configuración incompleta',
  CON_INCIDENCIAS: 'Con incidencias',
  CONFIGURADO: 'Configurado',
};

const CONFIGURATION_TONE: Record<ClientConfigurationStatus, string> = {
  SIN_CONFIGURAR: 'bg-slate-200 text-slate-600',
  CONFIGURACION_INCOMPLETA: 'bg-amber-100 text-amber-700',
  CON_INCIDENCIAS: 'bg-red-100 text-red-700',
  CONFIGURADO: 'bg-emerald-100 text-emerald-700',
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  const canReadAll = currentUser.permissions.includes('clients.read.all');
  const canReadAssigned = currentUser.permissions.includes('clients.read.assigned');
  if (!canReadAll && !canReadAssigned) {
    return <AccessDenied />;
  }

  // Admins see the full CRM-backed overview (configured or not, per §2 of the
  // admin panel spec); executives keep the existing self-service "Mis
  // clientes" view, unaffected — they never need to see unconfigured CRM
  // rows they have no stake in.
  if (canReadAll) {
    const query = (searchParams.q ?? '').trim();
    let overview: AdminClientsListResult = { available: true, clients: [] };
    let loadError: string | null = null;
    try {
      overview = await apiFetch<AdminClientsListResult>(
        `/clients/crm-overview${query ? `?search=${encodeURIComponent(query)}` : ''}`,
      );
    } catch (error) {
      loadError = error instanceof ApiError ? error.message : 'No se pudo cargar la lista.';
    }

    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">
            Clientes activos en el CRM, con su estado de configuración operativa en Mr Outreach.
          </p>
        </div>

        <form method="get" className="flex gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
          <input
            type="search"
            name="q"
            defaultValue={searchParams.q}
            placeholder="Buscar por nombre"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            Buscar
          </button>
        </form>

        {loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : !overview.available ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-700 shadow-sm">
            No se pudo conectar con el CRM en este momento. Intenta nuevamente en unos minutos.
          </div>
        ) : overview.clients.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">
            No hay clientes activos en el CRM que coincidan con la búsqueda.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {overview.clients.map((client) => (
              <li
                key={client.crmClientId}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold text-slate-900">{client.name}</span>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CONFIGURATION_TONE[client.configurationStatus]}`}
                    >
                      {CONFIGURATION_LABEL[client.configurationStatus]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    ID CRM {client.crmClientId}
                    {client.rubro ? ` · ${client.rubro}` : ''}
                    {client.managedClientId
                      ? ` · ${client.domainCount} dominio${client.domainCount === 1 ? '' : 's'} · ${client.mailboxCount} cuenta${client.mailboxCount === 1 ? '' : 's'} · ${client.assignedExecutiveCount} ejecutivo${client.assignedExecutiveCount === 1 ? '' : 's'}`
                      : ''}
                  </p>
                </div>
                {client.managedClientId ? (
                  <Link
                    href={`/dashboard/clients/${client.managedClientId}`}
                    className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                  >
                    Ver cliente
                  </Link>
                ) : (
                  <ConfigureClientButton crmClientId={client.crmClientId} name={client.name} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  let clients: ManagedClientSummary[] = [];
  let loadError: string | null = null;
  try {
    clients = await apiFetch<ManagedClientSummary[]>('/me/clients');
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudo cargar la lista.';
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Mis clientes</h1>
        <p className="text-sm text-slate-500">
          Empresas cuya operación de prospección se gestiona desde Mr Outreach.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : clients.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">
          Todavía no tienes clientes asignados. Pide a un administrador que te asigne uno.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/dashboard/clients/${client.id}`}
                className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5 transition-colors hover:border-brand-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold text-slate-900">{client.name}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      client.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {STATUS_LABEL[client.status]}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {client.domainCount} dominio{client.domainCount === 1 ? '' : 's'} ·{' '}
                  {client.mailboxCount} cuenta{client.mailboxCount === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-slate-500">
                  <span className="font-medium text-brand-700">
                    {client.newConversationCount} nueva
                    {client.newConversationCount === 1 ? '' : 's'}
                  </span>{' '}
                  · {client.pendingConversationCount} pendiente
                  {client.pendingConversationCount === 1 ? '' : 's'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
