import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { MailboxAdminOverviewItem } from '@outreach/shared-types';
import { ApiError, apiFetch } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import {
  ClickableTableRow,
  DataTable,
  DataTableContainer,
  DataTableHeader,
  DataTableHeaderCell,
  EmptyTableState,
  PrimaryItemLink,
} from '../../../components/ui/data-table';

const LOCAL_STATUS_LABEL: Record<MailboxAdminOverviewItem['status'], string> = {
  ACTIVE: 'Activa',
  INACTIVE: 'Inactiva',
  ARCHIVED: 'Archivada',
};

const LINK_STATUS_LABEL: Record<MailboxAdminOverviewItem['linkStatus'], string> = {
  LINK_PENDING: 'Vinculación pendiente',
  ACTIVE: 'Vinculada',
  UNLINK_REQUESTED: 'Desvinculación en curso',
  REVOKED: 'Desvinculada',
  LINK_ERROR: 'Error de vinculación',
  LEGACY: 'Cuenta heredada',
};

const LINK_STATUS_TONE: Record<MailboxAdminOverviewItem['linkStatus'], string> = {
  LINK_PENDING: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  UNLINK_REQUESTED: 'bg-amber-100 text-amber-700',
  REVOKED: 'bg-slate-200 text-slate-600',
  LINK_ERROR: 'bg-red-100 text-red-700',
  LEGACY: 'bg-slate-200 text-slate-600',
};

const SERVER_STATUS_LABEL: Record<string, string> = {
  CONNECTED: 'Conectada',
  DEGRADED: 'Degradada',
  DISCONNECTED: 'Desconectada',
  DISABLED: 'Deshabilitada',
  UNKNOWN: 'Desconocido',
};

const ORIGIN_LABEL: Record<MailboxAdminOverviewItem['linkSource'], string> = {
  SERVER_TOKEN: 'Vinculada por token',
  LEGACY_LOCAL: 'Cuenta heredada',
};

interface SearchParams {
  clientId?: string;
  domainId?: string;
  executiveId?: string;
  localStatus?: string;
  serverStatus?: string;
  canSend?: string;
  origin?: string;
  noPrimary?: string;
}

export default async function MailboxesOverviewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('mailboxes.read.all')) {
    return <AccessDenied />;
  }

  const canLink = currentUser.permissions.includes('mailboxes.link');

  let items: MailboxAdminOverviewItem[] = [];
  let loadError: string | null = null;
  try {
    items = await apiFetch<MailboxAdminOverviewItem[]>('/mailboxes/overview');
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : 'No se pudo cargar el listado.';
  }

  const hasAnyLinkedAccount = items.some((item) => item.linkSource === 'SERVER_TOKEN');

  // Filter option lists are derived from the data itself — only clients/
  // domains/executives that actually have a mailbox appear as choices.
  const clientOptions = uniqueBy(items.filter((i) => i.clientId), (i) => i.clientId!).map((i) => ({
    id: i.clientId!,
    name: i.clientName ?? i.clientId!,
  }));
  const domainOptions = uniqueBy(items.filter((i) => i.domainId), (i) => i.domainId!).map((i) => ({
    id: i.domainId!,
    name: i.domainName ?? i.domainId!,
  }));
  const executiveOptions = uniqueBy(
    items.filter((i) => i.primaryExecutive),
    (i) => i.primaryExecutive!.id,
  ).map((i) => i.primaryExecutive!);

  const clientId = searchParams.clientId ?? '';
  const domainId = searchParams.domainId ?? '';
  const executiveId = searchParams.executiveId ?? '';
  const localStatus = searchParams.localStatus ?? '';
  const serverStatus = searchParams.serverStatus ?? '';
  const canSend = searchParams.canSend ?? '';
  const origin = searchParams.origin ?? '';
  const noPrimary = searchParams.noPrimary === '1';

  const filtered = items
    .filter((item) => {
      if (clientId && item.clientId !== clientId) return false;
      if (domainId && item.domainId !== domainId) return false;
      if (executiveId && item.primaryExecutive?.id !== executiveId) return false;
      if (localStatus && item.status !== localStatus) return false;
      if (serverStatus && (item.serverStatusSnapshot ?? 'UNKNOWN') !== serverStatus) return false;
      if (canSend === 'true' && item.serverCanSendSnapshot !== true) return false;
      if (canSend === 'false' && item.serverCanSendSnapshot !== false) return false;
      if (origin === 'token' && item.linkSource !== 'SERVER_TOKEN') return false;
      if (origin === 'legacy' && item.linkSource !== 'LEGACY_LOCAL') return false;
      if (noPrimary && item.primaryExecutive) return false;
      return true;
    })
    // Token-linked accounts are the priority focus of this screen — legacy rows sort last.
    .sort((a, b) => (a.linkSource === b.linkSource ? 0 : a.linkSource === 'SERVER_TOKEN' ? -1 : 1));

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cuentas de correo</h1>
          <p className="text-sm text-slate-500">
            Cuentas vinculadas desde el servidor motor, con su estado técnico y asignación operativa.{' '}
            {filtered.length} de {items.length} cuenta{items.length === 1 ? '' : 's'}.
          </p>
        </div>
        {canLink && (
          <Link
            href="/dashboard/mailboxes/link"
            className="shrink-0 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            Vincular cuenta
          </Link>
        )}
      </div>

      {!hasAnyLinkedAccount ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-white p-10 text-center shadow-sm ring-1 ring-slate-900/5">
          <p className="text-base font-medium text-slate-900">No hay cuentas vinculadas al servidor.</p>
          <p className="max-w-md text-sm text-slate-500">
            Los clientes, dominios y cuentas se configuran en el servidor externo. Utiliza el token generado
            por el servidor para incorporar una cuenta a Mr Outreach.
          </p>
          {canLink && (
            <Link
              href="/dashboard/mailboxes/link"
              className="mt-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              Vincular primera cuenta
            </Link>
          )}
        </div>
      ) : (
        <>
          <form
            method="get"
            className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
          >
            <FilterSelect name="clientId" label="Cliente" value={clientId} options={clientOptions} />
            <FilterSelect name="domainId" label="Dominio" value={domainId} options={domainOptions} />
            <FilterSelect name="executiveId" label="Ejecutivo principal" value={executiveId} options={executiveOptions} />
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Estado local
              <select name="localStatus" defaultValue={localStatus} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">Todos</option>
                <option value="ACTIVE">Activa</option>
                <option value="INACTIVE">Inactiva</option>
                <option value="ARCHIVED">Archivada</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Estado del servidor
              <select name="serverStatus" defaultValue={serverStatus} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">Todos</option>
                <option value="CONNECTED">Conectada</option>
                <option value="DEGRADED">Degradada</option>
                <option value="DISCONNECTED">Desconectada</option>
                <option value="DISABLED">Deshabilitada</option>
                <option value="UNKNOWN">Desconocido</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Puede enviar
              <select name="canSend" defaultValue={canSend} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">Todos</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Origen de la cuenta
              <select name="origin" defaultValue={origin} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">Todas</option>
                <option value="token">Vinculada por token</option>
                <option value="legacy">Heredada</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-center pb-2 text-xs font-medium text-slate-600">
              <input type="checkbox" name="noPrimary" value="1" defaultChecked={noPrimary} className="rounded border-slate-300" />
              Solo cuentas sin ejecutivo principal
            </label>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              Filtrar
            </button>
            <Link
              href="/dashboard/mailboxes"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
            >
              Limpiar
            </Link>
          </form>

          {loadError ? (
            <p className="text-sm text-red-600">{loadError}</p>
          ) : (
            <DataTableContainer>
              <DataTable>
                <DataTableHeader>
                  <DataTableHeaderCell>Cliente</DataTableHeaderCell>
                  <DataTableHeaderCell>Dominio</DataTableHeaderCell>
                  <DataTableHeaderCell>Cuenta</DataTableHeaderCell>
                  <DataTableHeaderCell>Origen</DataTableHeaderCell>
                  <DataTableHeaderCell>Ejecutivo principal</DataTableHeaderCell>
                  <DataTableHeaderCell>Secundarios</DataTableHeaderCell>
                  <DataTableHeaderCell>Estado servidor</DataTableHeaderCell>
                  <DataTableHeaderCell>Puede enviar</DataTableHeaderCell>
                  <DataTableHeaderCell>Estado local</DataTableHeaderCell>
                  <DataTableHeaderCell>Última sync.</DataTableHeaderCell>
                </DataTableHeader>
                <tbody>
                  {filtered.map((item) => {
                    const href = `/dashboard/mailboxes/${item.id}/edit`;
                    return (
                      <ClickableTableRow key={item.id} href={href} ariaLabel={`Abrir detalle de ${item.email}`}>
                        <td className="px-4 py-3 text-slate-700">{item.clientName ?? '— Sin clasificar —'}</td>
                        <td className="px-4 py-3 text-slate-700">{item.domainName ?? '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <PrimaryItemLink href={href}>{item.email}</PrimaryItemLink>
                            <span className="text-xs text-slate-500">{item.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              item.linkSource === 'SERVER_TOKEN' ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {ORIGIN_LABEL[item.linkSource]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {item.primaryExecutive ? (
                            item.primaryExecutive.name
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              Sin principal
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{item.secondaryExecutiveCount}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {SERVER_STATUS_LABEL[item.serverStatusSnapshot ?? 'UNKNOWN'] ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {item.serverCanSendSnapshot === null ? (
                            '—'
                          ) : item.serverCanSendSnapshot ? (
                            <span className="text-emerald-700">Sí</span>
                          ) : (
                            <span className="text-red-600">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${LINK_STATUS_TONE[item.linkStatus]}`}>
                            {LINK_STATUS_LABEL[item.linkStatus]}
                          </span>
                          <div className="mt-0.5 text-xs text-slate-400">{LOCAL_STATUS_LABEL[item.status]}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {item.serverStatusCheckedAt
                            ? new Date(item.serverStatusCheckedAt).toLocaleString('es-CL')
                            : 'Nunca'}
                        </td>
                      </ClickableTableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <EmptyTableState colSpan={10} message="Ninguna cuenta coincide con los filtros seleccionados." />
                  )}
                </tbody>
              </DataTable>
            </DataTableContainer>
          )}
        </>
      )}
    </div>
  );
}

function uniqueBy<T, K>(items: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { id: string; name: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      <select name={name} defaultValue={value} className="min-w-[10rem] rounded-md border border-slate-300 px-3 py-2 text-sm">
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
