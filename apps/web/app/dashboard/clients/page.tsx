import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ManagedClientSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';

const STATUS_LABEL: Record<ManagedClientSummary['status'], string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  SUSPENDED: 'Suspendido',
  ARCHIVED: 'Archivado',
};

/**
 * Clientes/dominios son proyecciones de solo lectura derivadas de las
 * cuentas vinculadas por token — no existe administración manual de
 * clientes en Mr Outreach (§7 de la limpieza de interfaz). Esta pantalla
 * solo sirve la vista "Mis clientes" del ejecutivo.
 */
export default async function ClientsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('clients.read.assigned')) {
    return <AccessDenied />;
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
          Todavía no tienes clientes asignados. Se asignan automáticamente al vincular una cuenta de correo.
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
