import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ManagedClientSummary, RoleSummary, UserSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { ExecutiveRow } from './executive-row';

const PAGE_SIZE = 20;

export default async function ExecutivesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; role?: string; page?: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('users.read')) {
    return <AccessDenied />;
  }

  let executives: UserSummary[] = [];
  let roles: RoleSummary[] = [];
  let loadError: string | null = null;
  try {
    [executives, roles] = await Promise.all([
      apiFetch<UserSummary[]>('/users'),
      apiFetch<RoleSummary[]>('/roles'),
    ]);
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudo cargar la lista.';
  }

  const query = (searchParams.q ?? '').trim().toLowerCase();
  const statusFilter = searchParams.status ?? '';
  const roleFilter = searchParams.role ?? '';
  const filtered = executives.filter((executive) => {
    const matchesQuery =
      !query ||
      executive.name.toLowerCase().includes(query) ||
      executive.email.toLowerCase().includes(query);
    const matchesStatus = !statusFilter || executive.status === statusFilter;
    const matchesRole = !roleFilter || executive.roleId === roleFilter;
    return matchesQuery && matchesStatus && matchesRole;
  });

  const currentPage = Math.max(1, Number(searchParams.page ?? '1') || 1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const canCreate = currentUser.permissions.includes('users.create');
  const canSeeAssignedClients = currentUser.permissions.includes('clients.read.all');

  const assignedClientCounts = new Map<string, number>();
  if (canSeeAssignedClients && !loadError) {
    await Promise.all(
      paged.map(async (executive) => {
        try {
          const clients = await apiFetch<ManagedClientSummary[]>(`/users/${executive.id}/clients`);
          assignedClientCounts.set(executive.id, clients.length);
        } catch {
          assignedClientCounts.set(executive.id, 0);
        }
      }),
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Ejecutivos</h1>
        {canCreate && (
          <Link
            href="/dashboard/executives/new"
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Crear ejecutivo
          </Link>
        )}
      </div>

      <form
        method="get"
        className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
      >
        <input
          type="search"
          name="q"
          defaultValue={searchParams.q}
          placeholder="Buscar por nombre o correo"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <select
          name="status"
          defaultValue={searchParams.status ?? ''}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Todos los estados</option>
          <option value="ACTIVE">Activos</option>
          <option value="INACTIVE">Inactivos</option>
        </select>
        <select
          name="role"
          defaultValue={searchParams.role ?? ''}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Todos los roles</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
        >
          Filtrar
        </button>
      </form>

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Correo</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Estado</th>
                {canSeeAssignedClients && <th className="px-4 py-3">Clientes asignados</th>}
                <th className="px-4 py-3">Creado</th>
                <th className="px-4 py-3">Último acceso</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((executive) => (
                <ExecutiveRow
                  key={executive.id}
                  executive={executive}
                  assignedClientCount={assignedClientCounts.get(executive.id)}
                  showAssignedClients={canSeeAssignedClients}
                />
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={canSeeAssignedClients ? 7 : 6} className="px-4 py-6 text-center text-slate-500">
                    Sin resultados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loadError && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => {
            const params = new URLSearchParams();
            if (searchParams.q) params.set('q', searchParams.q);
            if (searchParams.status) params.set('status', searchParams.status);
            if (searchParams.role) params.set('role', searchParams.role);
            params.set('page', String(page));
            return (
              <Link
                key={page}
                href={`/dashboard/executives?${params.toString()}`}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  page === currentPage
                    ? 'bg-brand-600 text-white'
                    : 'border border-slate-300 text-slate-700 hover:border-brand-300 hover:text-brand-700'
                }`}
              >
                {page}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
