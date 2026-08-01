'use client';

import { useMemo, useState } from 'react';
import type { SequenceTemplateSummary } from '../../../lib/sequence-template-types';
import {
  ClickableTableRow,
  DataTable,
  DataTableContainer,
  DataTableHeader,
  DataTableHeaderCell,
  PrimaryItemLink,
} from '../../../components/ui/data-table';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  PUBLISHING: 'Publicando…',
  PUBLISHED: 'Publicada',
  PUBLISH_FAILED: 'Publicación fallida',
  ARCHIVED: 'Archivada',
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PUBLISHING: 'bg-amber-100 text-amber-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  PUBLISH_FAILED: 'bg-red-100 text-red-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
};

type TabKey = 'drafts' | 'published' | 'archived';

const TAB_LABELS: Record<TabKey, string> = {
  drafts: 'Borradores',
  published: 'Publicadas',
  archived: 'Archivadas',
};

/** §5 — visually separate sections, not a status filter over one shared table. */
function bucketFor(template: SequenceTemplateSummary): TabKey {
  if (template.status === 'ARCHIVED') return 'archived';
  if (template.status === 'DRAFT' || template.status === 'PUBLISH_FAILED') return 'drafts';
  return 'published'; // PUBLISHED, PUBLISHING
}

export function SequenceTemplatesList({ templates }: { templates: SequenceTemplateSummary[] }) {
  const [tab, setTab] = useState<TabKey>('drafts');
  const [search, setSearch] = useState('');

  const buckets = useMemo(() => {
    const grouped: Record<TabKey, SequenceTemplateSummary[]> = { drafts: [], published: [], archived: [] };
    for (const template of templates) grouped[bucketFor(template)].push(template);
    return grouped;
  }, [templates]);

  const query = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = buckets[tab];
    if (!query) return list;
    return list.filter((t) => t.name.toLowerCase().includes(query));
  }, [buckets, tab, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {TAB_LABELS[key]} ({buckets[key].length})
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre…"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {templates.length === 0
            ? 'Todavía no tienes plantillas. Crea la primera para empezar a diseñar tu prospección.'
            : query
              ? 'Ninguna plantilla coincide con la búsqueda.'
              : `No tienes plantillas en "${TAB_LABELS[tab]}".`}
        </div>
      ) : (
        <DataTableContainer>
          <DataTable>
            <DataTableHeader>
              <DataTableHeaderCell>Nombre</DataTableHeaderCell>
              <DataTableHeaderCell>Cliente</DataTableHeaderCell>
              <DataTableHeaderCell>Cuenta</DataTableHeaderCell>
              <DataTableHeaderCell>Versión</DataTableHeaderCell>
              <DataTableHeaderCell>Última actualización</DataTableHeaderCell>
              <DataTableHeaderCell>Publicada</DataTableHeaderCell>
              <DataTableHeaderCell>Estado del servidor</DataTableHeaderCell>
            </DataTableHeader>
            <tbody>
              {visible.map((template) => {
                const href = `/dashboard/sequence-templates/${template.id}`;
                return (
                  <ClickableTableRow key={template.id} href={href} ariaLabel={`Abrir plantilla ${template.name}`}>
                    <td className="px-4 py-3">
                      <PrimaryItemLink href={href}>{template.name}</PrimaryItemLink>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{template.clientName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{template.mailboxEmail}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {template.latestPublishedVersion ? `v${template.latestPublishedVersion.versionNumber}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{new Date(template.updatedAt).toLocaleString('es-CL')}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {template.latestPublishedVersion?.acceptedAt
                        ? new Date(template.latestPublishedVersion.acceptedAt).toLocaleString('es-CL')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[template.status]}`}>
                        {STATUS_LABELS[template.status]}
                      </span>
                    </td>
                  </ClickableTableRow>
                );
              })}
            </tbody>
          </DataTable>
        </DataTableContainer>
      )}
    </div>
  );
}
