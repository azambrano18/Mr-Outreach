import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { VariableSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { ArchiveRestoreButton } from './archive-restore-button';
import { DeleteVariableButton } from './delete-variable-button';

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-500'}`} />
      {active ? 'Activa' : 'Archivada'}
    </span>
  );
}

export default async function VariablesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('variables.read')) {
    return <AccessDenied />;
  }

  let variables: VariableSummary[] = [];
  let loadError: string | null = null;
  try {
    variables = await apiFetch<VariableSummary[]>('/variables');
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudo cargar la lista.';
  }

  const query = (searchParams.q ?? '').trim().toLowerCase();
  const statusFilter = searchParams.status ?? '';
  const filtered = variables.filter((variable) => {
    const matchesQuery =
      !query ||
      variable.key.toLowerCase().includes(query) ||
      variable.label.toLowerCase().includes(query);
    const matchesStatus = !statusFilter || variable.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const canCreate = currentUser.permissions.includes('variables.create');
  const canUpdate = currentUser.permissions.includes('variables.update');
  const canArchive = currentUser.permissions.includes('variables.archive');
  const canDelete = currentUser.permissions.includes('variables.delete');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Variables</h1>
        {canCreate && (
          <Link
            href="/dashboard/variables/new"
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Nueva variable
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">
        Este catálogo es lo que el editor de textos ofrece para insertar con un clic — evita que
        cada persona escriba{' '}
        <code className="rounded bg-brand-100 px-1 py-0.5">{'{nombre}'}</code> a mano y con
        errores de formato.
      </div>

      <form
        method="get"
        className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
      >
        <input
          type="search"
          name="q"
          defaultValue={searchParams.q}
          placeholder="Buscar por clave o nombre"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <select
          name="status"
          defaultValue={searchParams.status ?? ''}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Todos los estados</option>
          <option value="ACTIVE">Activas</option>
          <option value="ARCHIVED">Archivadas</option>
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
                <th className="px-4 py-3">Variable</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Creación</th>
                <th className="px-4 py-3">Modificación</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((variable) => (
                <tr
                  key={variable.id}
                  className="border-b border-slate-100 transition-colors last:border-0 hover:bg-brand-50/50"
                >
                  <td className="px-4 py-3">{variable.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{`{${variable.key}}`}</td>
                  <td className="px-4 py-3">
                    <StatusPill active={variable.status === 'ACTIVE'} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(variable.createdAt).toLocaleDateString('es-CL')}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(variable.updatedAt).toLocaleDateString('es-CL')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canUpdate && (
                        <Link
                          href={`/dashboard/variables/${variable.id}/edit`}
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                        >
                          Editar
                        </Link>
                      )}
                      {canArchive && (
                        <ArchiveRestoreButton
                          variableId={variable.id}
                          active={variable.status === 'ACTIVE'}
                        />
                      )}
                      {canDelete && (
                        <DeleteVariableButton variableId={variable.id} variableKey={variable.key} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    Sin resultados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
