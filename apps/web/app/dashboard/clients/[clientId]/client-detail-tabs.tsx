'use client';

import Link from 'next/link';
import { useState } from 'react';
import type {
  AuditLogEntry,
  ClientAssigneeSummary,
  DomainSummary,
  MailboxSummary,
  UserSummary,
} from '@outreach/shared-types';
import { AddDomainForm } from '../../../../components/clients/add-domain-form';
import { ClientAssigneesManager } from '../../../../components/clients/client-assignees-manager';
import { ToggleDomainStatusButton } from '../../../../components/clients/toggle-domain-status-button';

type TabKey = 'dominios' | 'cuentas' | 'ejecutivos' | 'auditoria';

const DOMAIN_STATUS_LABEL: Record<DomainSummary['status'], string> = {
  ACTIVE: 'Operativo',
  INACTIVE: 'Inactivo',
  ARCHIVED: 'Archivado',
};

const CONNECTION_LABEL: Record<MailboxSummary['connectionStatus'], string> = {
  NOT_TESTED: 'Sin probar',
  TESTING: 'Probando…',
  CONNECTED: 'Conectada',
  PARTIALLY_CONNECTED: 'Conexión parcial',
  CONNECTION_ERROR: 'Error de conexión',
  ENGINE_UNAVAILABLE: 'Motor no disponible',
};

export function ClientDetailTabs({
  clientId,
  domains,
  mailboxes,
  assignees,
  activeExecutives,
  auditLog,
  canManageDomains,
  canAssign,
  canReadAudit,
}: {
  clientId: string;
  domains: DomainSummary[];
  mailboxes: MailboxSummary[];
  assignees: ClientAssigneeSummary[];
  activeExecutives: UserSummary[];
  auditLog: AuditLogEntry[];
  canManageDomains: boolean;
  canAssign: boolean;
  canReadAudit: boolean;
}) {
  const [tab, setTab] = useState<TabKey>('dominios');

  const tabs: { key: TabKey; label: string; enabled: boolean }[] = [
    { key: 'dominios', label: 'Dominios', enabled: true },
    { key: 'cuentas', label: 'Cuentas de correo', enabled: true },
    { key: 'ejecutivos', label: 'Ejecutivos asignados', enabled: canAssign },
    { key: 'auditoria', label: 'Auditoría', enabled: canReadAudit },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs
          .filter((t) => t.enabled)
          .map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {tab === 'dominios' && (
        <div className="flex flex-col gap-3">
          {canManageDomains && <AddDomainForm clientId={clientId} />}
          {domains.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">
              Este cliente todavía no tiene dominios registrados.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {domains.map((domain) => (
                <li
                  key={domain.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
                >
                  <Link
                    href={`/dashboard/clients/${clientId}/domains/${domain.id}`}
                    className="flex min-w-0 flex-1 flex-col gap-1"
                  >
                    <span className="truncate text-base font-semibold text-slate-900">{domain.domainName}</span>
                    <span
                      className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        domain.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {DOMAIN_STATUS_LABEL[domain.status]}
                    </span>
                    <span className="text-xs text-slate-500">
                      {domain.mailboxCount} cuenta{domain.mailboxCount === 1 ? '' : 's'}
                    </span>
                  </Link>
                  {canManageDomains && (
                    <ToggleDomainStatusButton domainId={domain.id} active={domain.status === 'ACTIVE'} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'cuentas' && (
        <div className="flex flex-col gap-3">
          {mailboxes.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">
              Este cliente todavía no tiene cuentas de correo vinculadas. Regístralas desde el detalle de un
              dominio.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {mailboxes.map((mailbox) => (
                <li
                  key={mailbox.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-base font-semibold text-slate-900">{mailbox.name}</span>
                    <span className="truncate text-xs text-slate-500">{mailbox.email}</span>
                    <span className="text-xs text-slate-500">
                      {mailbox.status === 'ACTIVE' ? 'Operativa' : 'Inactiva'} ·{' '}
                      {CONNECTION_LABEL[mailbox.connectionStatus]}
                    </span>
                  </div>
                  <Link
                    href={`/dashboard/mailboxes/${mailbox.id}/edit`}
                    className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                  >
                    Configurar
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'ejecutivos' && (
        <ClientAssigneesManager clientId={clientId} assignees={assignees} activeExecutives={activeExecutives} />
      )}

      {tab === 'auditoria' && (
        <ul className="flex flex-col gap-1.5">
          {auditLog.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-900/5"
            >
              <div>
                <span className="font-mono text-xs text-brand-700">{entry.action}</span>
                <span className="ml-2 text-slate-600">
                  {entry.entityType} · {entry.entityId}
                </span>
              </div>
              <span className="font-mono text-xs text-slate-500">
                {new Date(entry.createdAt).toLocaleString('es-CL')}
              </span>
            </li>
          ))}
          {auditLog.length === 0 && (
            <li className="rounded-md border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">
              Sin actividad registrada para este cliente.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
