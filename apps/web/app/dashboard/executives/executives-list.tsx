'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { UserSummary } from '@outreach/shared-types';
import {
  DataTable,
  DataTableContainer,
  DataTableHeader,
  DataTableHeaderCell,
  EmptyTableState,
} from '../../../components/ui/data-table';
import { EntitySearchInput } from '../../../components/ui/entity-search-input';
import { matchesSearch } from '../../../lib/search';
import { ExecutiveRow } from './executive-row';

const PAGE_SIZE = 20;

/**
 * §11 — `/users` returns the full organization roster in one request (no
 * backend pagination exists for it), so search filters client-side over
 * the already-fetched list. The previous status/role `<select>` filters
 * were removed per spec §7 — the search box (nombre/correo) is now the
 * only way to narrow this list.
 */
export function ExecutivesList({
  executives,
  loadError,
  canCreate,
}: {
  executives: UserSummary[];
  loadError: string | null;
  canCreate: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return executives.filter((executive) => matchesSearch(search, executive.name, executive.email));
  }, [executives, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleSearchChange(next: string): void {
    setSearch(next);
    setPage(1);
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
            Crear usuario
          </Link>
        )}
      </div>

      <EntitySearchInput
        value={search}
        onChange={handleSearchChange}
        placeholder="Buscar por nombre o correo"
        ariaLabel="Buscar usuarios"
      />

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <DataTableContainer>
          <DataTable>
            <DataTableHeader>
              <DataTableHeaderCell>Nombre</DataTableHeaderCell>
              <DataTableHeaderCell>Correo</DataTableHeaderCell>
              <DataTableHeaderCell>Rol</DataTableHeaderCell>
              <DataTableHeaderCell>Estado</DataTableHeaderCell>
              <DataTableHeaderCell>Último acceso</DataTableHeaderCell>
            </DataTableHeader>
            <tbody>
              {paged.map((executive) => (
                <ExecutiveRow key={executive.id} executive={executive} />
              ))}
              {paged.length === 0 && (
                <EmptyTableState
                  colSpan={5}
                  message={
                    search
                      ? `No encontramos usuarios que coincidan con "${search}".`
                      : 'No hay usuarios registrados.'
                  }
                />
              )}
            </tbody>
          </DataTable>
        </DataTableContainer>
      )}

      {!loadError && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => setPage(pageNumber)}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                pageNumber === currentPage
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-300 text-slate-700 hover:border-brand-300 hover:text-brand-700'
              }`}
            >
              {pageNumber}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
