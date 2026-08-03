'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { MailboxAdminOverviewItem } from '@outreach/shared-types';
import {
  ClickableTableRow,
  DataTable,
  DataTableContainer,
  DataTableHeader,
  DataTableHeaderCell,
  EmptyTableState,
  PrimaryItemLink,
} from '../../../components/ui/data-table';
import { EntitySearchInput } from '../../../components/ui/entity-search-input';
import { matchesSearch } from '../../../lib/search';

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

/**
 * §11 — the full overview is already loaded in one request (no backend
 * pagination exists for this endpoint), so search filters client-side over
 * the already-fetched list rather than adding a round trip. The dedicated
 * filters (cliente/dominio/ejecutivo/estado/servidor/origen/sin-principal)
 * were removed per spec §6 — the search box below covers cliente/correo/
 * dominio, which is what this screen is actually used to find someone by.
 * Everything else (ejecutivos secundarios, IDs externos, estado técnico
 * detallado, fechas de vinculación) moved to the account's own detail page
 * — it was already all there (see server-linked-mailbox-panel.tsx sections
 * A-C) and nothing here deletes it, only stops repeating it in the list.
 */
export function MailboxesList({
  items,
  loadError,
  canLink,
  deletedEmail,
}: {
  items: MailboxAdminOverviewItem[];
  loadError: string | null;
  canLink: boolean;
  /** Set by the detail page's redirect right after a successful deletion — see server-linked-mailbox-panel.tsx. */
  deletedEmail?: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showDeletedBanner, setShowDeletedBanner] = useState(Boolean(deletedEmail));
  const hasAnyLinkedAccount = items.some((item) => item.linkSource === 'SERVER_TOKEN');

  function dismissDeletedBanner(): void {
    setShowDeletedBanner(false);
    // Strips "?deleted=..." from the URL so reloading/reopening this page
    // later never re-shows the banner for a long-gone deletion.
    router.replace('/dashboard/mailboxes');
  }

  const filtered = useMemo(() => {
    return items
      .filter((item) => matchesSearch(search, item.clientName, item.email, item.domainName))
      // Token-linked accounts are the priority focus of this screen — legacy rows sort last.
      .sort((a, b) => (a.linkSource === b.linkSource ? 0 : a.linkSource === 'SERVER_TOKEN' ? -1 : 1));
  }, [items, search]);

  return (
    <div className="flex w-full flex-col gap-6">
      {showDeletedBanner && deletedEmail && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>Cuenta {deletedEmail} eliminada correctamente.</span>
          <button
            type="button"
            onClick={dismissDeletedBanner}
            aria-label="Cerrar aviso"
            className="rounded-md px-2 py-0.5 text-emerald-700 hover:bg-emerald-100"
          >
            ×
          </button>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cuentas de correo</h1>
          <p className="text-sm text-slate-500">
            Cuentas vinculadas desde el servidor motor. {filtered.length} de {items.length} cuenta
            {items.length === 1 ? '' : 's'}.
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
          <p className="text-base font-medium text-slate-900">No hay cuentas de correo vinculadas.</p>
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
          <EntitySearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por cliente, correo o dominio"
            ariaLabel="Buscar cuentas de correo"
          />

          {loadError ? (
            <p className="text-sm text-red-600">{loadError}</p>
          ) : (
            <DataTableContainer>
              <DataTable>
                <DataTableHeader>
                  <DataTableHeaderCell>Cuenta de correo</DataTableHeaderCell>
                  <DataTableHeaderCell>Cliente</DataTableHeaderCell>
                  <DataTableHeaderCell>Estado</DataTableHeaderCell>
                  <DataTableHeaderCell>Ejecutivo principal</DataTableHeaderCell>
                  <DataTableHeaderCell>Última actualización</DataTableHeaderCell>
                </DataTableHeader>
                <tbody>
                  {filtered.map((item) => {
                    const href = `/dashboard/mailboxes/${item.id}/edit`;
                    return (
                      <ClickableTableRow key={item.id} href={href} ariaLabel={`Abrir detalle de ${item.email}`}>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <PrimaryItemLink href={href}>{item.email}</PrimaryItemLink>
                            <span className="text-xs text-slate-500">{item.domainName ?? '—'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{item.clientName ?? '— Sin clasificar —'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${LINK_STATUS_TONE[item.linkStatus]}`}
                          >
                            {LINK_STATUS_LABEL[item.linkStatus]}
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
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {item.serverStatusCheckedAt
                            ? new Date(item.serverStatusCheckedAt).toLocaleString('es-CL')
                            : 'Nunca'}
                        </td>
                      </ClickableTableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <EmptyTableState
                      colSpan={5}
                      message={
                        search
                          ? `No encontramos cuentas que coincidan con "${search}".`
                          : 'No hay cuentas de correo vinculadas.'
                      }
                    />
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
