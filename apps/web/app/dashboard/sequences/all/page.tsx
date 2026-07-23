import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { AdminClientsListResult, AdminSequenceListRow, UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  PAUSED: 'Pausada',
  ARCHIVED: 'Archivada',
};

const PUBLISH_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Solicitada',
  ACCEPTED: 'Aceptada',
  PROCESSING: 'Procesando',
  SCHEDULED: 'Programada',
  ACTIVE: 'Activa',
  COMPLETED: 'Completada',
  FAILED: 'Con errores',
  CANCELLED: 'Cancelada',
};

interface SearchParams {
  executiveId?: string;
  clientId?: string;
  status?: string;
  activeOnly?: string;
  createdFrom?: string;
  createdTo?: string;
  startedFrom?: string;
  startedTo?: string;
  search?: string;
  page?: string;
}

/** Spec §4 — the admin's global "todas las secuencias" monitoring panel. */
export default async function AllSequencesPage({ searchParams }: { searchParams: SearchParams }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('sequences.read_all')) {
    return <AccessDenied />;
  }

  const query = new URLSearchParams();
  if (searchParams.executiveId) query.set('executiveId', searchParams.executiveId);
  if (searchParams.clientId) query.set('clientId', searchParams.clientId);
  if (searchParams.status) query.set('status', searchParams.status);
  if (searchParams.activeOnly) query.set('activeOnly', searchParams.activeOnly);
  if (searchParams.createdFrom) query.set('createdFrom', new Date(searchParams.createdFrom).toISOString());
  if (searchParams.createdTo) query.set('createdTo', new Date(searchParams.createdTo).toISOString());
  if (searchParams.startedFrom) query.set('startedFrom', new Date(searchParams.startedFrom).toISOString());
  if (searchParams.startedTo) query.set('startedTo', new Date(searchParams.startedTo).toISOString());
  if (searchParams.search) query.set('search', searchParams.search);

  let rows: AdminSequenceListRow[] = [];
  let loadError: string | null = null;
  try {
    rows = await apiFetch<AdminSequenceListRow[]>(`/sequences?${query.toString()}`);
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudieron cargar las secuencias.';
  }

  const [executives, clientsOverview] = await Promise.all([
    apiFetch<UserSummary[]>('/users').catch(() => []),
    apiFetch<AdminClientsListResult>('/clients/crm-overview').catch(() => ({ available: false, clients: [] })),
  ]);
  const configuredClients = clientsOverview.clients.filter((c) => c.managedClientId);

  const currentPage = Math.max(1, Number(searchParams.page ?? '1') || 1);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paged = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function pageHref(page: number): string {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    return `/dashboard/sequences/all?${params.toString()}`;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Secuencias</h1>
          <p className="text-sm text-slate-500">
            Historial y monitoreo de las secuencias de todos los ejecutivos.
          </p>
        </div>
        {currentUser.permissions.includes('sequences.assign') && (
          <Link
            href="/dashboard/sequences/new"
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Nueva secuencia
          </Link>
        )}
      </div>

      <form
        method="get"
        className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            name="search"
            defaultValue={searchParams.search}
            placeholder="Buscar por nombre, cliente, ejecutivo o cuenta"
            className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
          <select
            name="executiveId"
            defaultValue={searchParams.executiveId ?? ''}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Todos los ejecutivos</option>
            {executives.map((executive) => (
              <option key={executive.id} value={executive.id}>
                {executive.name}
              </option>
            ))}
          </select>
          <select
            name="clientId"
            defaultValue={searchParams.clientId ?? ''}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Todos los clientes</option>
            {configuredClients.map((client) => (
              <option key={client.managedClientId} value={client.managedClientId as string}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={searchParams.status ?? ''}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Todos los estados</option>
            <option value="DRAFT">Borrador</option>
            <option value="PAUSED">Pausada</option>
            <option value="ARCHIVED">Archivada</option>
          </select>
          <select
            name="activeOnly"
            defaultValue={searchParams.activeOnly ?? ''}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Activas y finalizadas</option>
            <option value="true">Solo activas</option>
            <option value="false">Solo finalizadas</option>
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-xs text-slate-600">
          <label className="flex flex-col gap-1">
            Creada desde
            <input
              type="date"
              name="createdFrom"
              defaultValue={searchParams.createdFrom}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            Creada hasta
            <input
              type="date"
              name="createdTo"
              defaultValue={searchParams.createdTo}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            Inicio desde
            <input
              type="date"
              name="startedFrom"
              defaultValue={searchParams.startedFrom}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            Inicio hasta
            <input
              type="date"
              name="startedTo"
              defaultValue={searchParams.startedTo}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            Filtrar
          </button>
          <Link
            href="/dashboard/sequences/all"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            Limpiar
          </Link>
        </div>
      </form>

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3">Secuencia</th>
                <th className="px-3 py-3">Cliente</th>
                <th className="px-3 py-3">Cuenta</th>
                <th className="px-3 py-3">Ejecutivo</th>
                <th className="px-3 py-3">Creado por</th>
                <th className="px-2 py-3 text-center">Estado</th>
                <th className="px-2 py-3 text-center">Prospectos</th>
                <th className="px-2 py-3 text-center">Env. 1</th>
                <th className="px-2 py-3 text-center">Env. 2</th>
                <th className="px-2 py-3 text-center">Env. 3</th>
                <th className="px-2 py-3 text-center">Respuestas</th>
                <th className="px-2 py-3 text-center">Detenidos</th>
                <th className="px-2 py-3 text-center">Errores</th>
                <th className="px-3 py-3">Última actividad</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 transition-colors last:border-0 hover:bg-brand-50/50"
                >
                  <td className="max-w-[260px] px-3 py-3">
                    <Link
                      href={`/dashboard/sequences/all/${row.id}`}
                      className="font-medium text-brand-700 hover:underline"
                      title={row.name}
                    >
                      {row.name}
                    </Link>
                    {row.publishStatus && (
                      <div className="text-[11px] text-slate-500">
                        {PUBLISH_STATUS_LABEL[row.publishStatus] ?? row.publishStatus}
                      </div>
                    )}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-3 text-slate-600" title={row.clientName ?? undefined}>
                    {row.clientName ?? '—'}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-3 text-slate-600" title={row.mailboxEmail ?? undefined}>
                    {row.mailboxEmail ?? '—'}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-slate-600" title={row.executiveName}>
                    {row.executiveName}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-3 text-slate-600" title={row.createdByName}>
                    {row.createdByName}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-center text-slate-600">{row.prospectCount}</td>
                  <td className="px-2 py-3 text-center text-slate-600">{row.sentStep1}</td>
                  <td className="px-2 py-3 text-center text-slate-600">{row.sentStep2}</td>
                  <td className="px-2 py-3 text-center text-slate-600">{row.sentStep3}</td>
                  <td className="px-2 py-3 text-center text-slate-600">{row.repliedCount}</td>
                  <td className="px-2 py-3 text-center text-slate-600">{row.stoppedCount}</td>
                  <td className="px-2 py-3 text-center text-slate-600">{row.errorCount}</td>
                  <td className="px-3 py-3 text-slate-500">
                    {row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString('es-CL') : '—'}
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-slate-400">
                    No hay secuencias que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <Link
              key={page}
              href={pageHref(page)}
              className={`rounded-md px-2.5 py-1 ${
                page === currentPage ? 'bg-brand-600 text-white' : 'border border-slate-300 hover:border-brand-300'
              }`}
            >
              {page}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
