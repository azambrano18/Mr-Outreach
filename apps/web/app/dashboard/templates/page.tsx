import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { TemplateSummary } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { TemplateActions } from './template-actions';

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

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('templates.read')) {
    return <AccessDenied />;
  }

  let templates: TemplateSummary[] = [];
  let loadError: string | null = null;
  try {
    templates = await apiFetch<TemplateSummary[]>('/templates');
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudo cargar la lista.';
  }

  const query = (searchParams.q ?? '').trim().toLowerCase();
  const statusFilter = searchParams.status ?? '';
  const filtered = templates.filter((template) => {
    const matchesQuery =
      !query ||
      template.name.toLowerCase().includes(query) ||
      template.subject.toLowerCase().includes(query);
    const matchesStatus = !statusFilter || template.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const canCreate = currentUser.permissions.includes('templates.create');
  const canUpdate = currentUser.permissions.includes('templates.update');
  const canDuplicate = currentUser.permissions.includes('templates.duplicate');
  const canArchive = currentUser.permissions.includes('templates.archive');
  const canDelete = currentUser.permissions.includes('templates.delete');

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Textos</h1>
        {canCreate && (
          <Link
            href="/dashboard/templates/new"
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Nuevo texto
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
          placeholder="Buscar por nombre o asunto"
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
                <th className="px-4 py-3">Asunto</th>
                <th className="px-4 py-3">Variables</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Actualizada</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((template) => (
                <tr
                  key={template.id}
                  className="border-b border-slate-100 transition-colors last:border-0 hover:bg-brand-50/50"
                >
                  <td className="px-4 py-3">{template.name}</td>
                  <td className="px-4 py-3 text-slate-600">{template.subject}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {template.variables.length === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        template.variables.map((variable) => (
                          <span
                            key={variable}
                            className="rounded-full bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-700"
                          >
                            {`{${variable}}`}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill active={template.status === 'ACTIVE'} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {new Date(template.updatedAt).toLocaleDateString('es-CL')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {canUpdate && (
                        <Link
                          href={`/dashboard/templates/${template.id}/edit`}
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                        >
                          Editar
                        </Link>
                      )}
                      <TemplateActions
                        templateId={template.id}
                        active={template.status === 'ACTIVE'}
                        canDuplicate={canDuplicate}
                        canArchive={canArchive}
                        canDelete={canDelete}
                      />
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
