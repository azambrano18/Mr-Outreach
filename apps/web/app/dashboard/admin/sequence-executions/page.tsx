import { redirect } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import type { SequenceExecutionSummary } from '../../../../lib/sequence-execution-types';
import {
  ClickableTableRow,
  DataTable,
  DataTableContainer,
  DataTableHeader,
  DataTableHeaderCell,
  PrimaryItemLink,
} from '../../../../components/ui/data-table';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  VALIDATING: 'Validando',
  SUBMITTING: 'Enviando…',
  SUBMISSION_UNKNOWN: 'Verificando envío…',
  ACCEPTED: 'Aceptada',
  RUNNING: 'En ejecución',
  COMPLETED: 'Completada',
  FAILED: 'Fallida',
  REJECTED: 'Rechazada',
};

/** §2 — server-administered per-prospect lifecycle, shown in plain language; "Step" is never shown to the executive. */
const PROSPECT_STATE_LABELS: Record<string, string> = {
  STEP_01_PENDING: 'Envío 1 pendiente',
  STEP_01_PROCESSING: 'Envío 1 en proceso',
  STEP_01_SENT: 'Envío 1 enviado',
  STEP_02_PENDING: 'Envío 2 pendiente',
  STEP_02_PROCESSING: 'Envío 2 en proceso',
  STEP_02_SENT: 'Envío 2 enviado',
  STEP_03_PENDING: 'Envío 3 pendiente',
  STEP_03_PROCESSING: 'Envío 3 en proceso',
  STEP_03_SENT: 'Envío 3 enviado',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
};

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('es-CL') : '—';
}

/**
 * §13/§14 — read-only. No "Nueva gestión" button, no edit affordances
 * anywhere on this page. The server administers its own processing
 * internally; this table shows only the real submission-lifecycle
 * instants Mr Outreach actually has (never a manually-picked date) and
 * the prospects' initial per-prospect state, in plain language.
 */
export default async function AdminSequenceExecutionsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_executions.monitor_all')) {
    return <AccessDenied />;
  }

  const executions = await apiFetch<SequenceExecutionSummary[]>('/admin/sequence-executions');

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Monitor de gestiones</h1>
        <p className="text-sm text-slate-500">
          Solo lectura — gestiones creadas por los ejecutivos y su estado reportado por el servidor.
        </p>
      </div>

      {executions.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Todavía no hay gestiones creadas en la organización.
        </div>
      ) : (
        <DataTableContainer>
          <DataTable>
            <DataTableHeader>
              <DataTableHeaderCell>Gestión</DataTableHeaderCell>
              <DataTableHeaderCell>Ejecutivo</DataTableHeaderCell>
              <DataTableHeaderCell>Cliente</DataTableHeaderCell>
              <DataTableHeaderCell>Dominio</DataTableHeaderCell>
              <DataTableHeaderCell>Cuenta</DataTableHeaderCell>
              <DataTableHeaderCell>Plantilla</DataTableHeaderCell>
              <DataTableHeaderCell>Prospectos</DataTableHeaderCell>
              <DataTableHeaderCell>Creada</DataTableHeaderCell>
              <DataTableHeaderCell>Enviada al servidor</DataTableHeaderCell>
              <DataTableHeaderCell>Recibida por el servidor</DataTableHeaderCell>
              <DataTableHeaderCell>Inicio real</DataTableHeaderCell>
              <DataTableHeaderCell>Estado local</DataTableHeaderCell>
              <DataTableHeaderCell>Estado servidor</DataTableHeaderCell>
              <DataTableHeaderCell>Estado inicial prospectos</DataTableHeaderCell>
              <DataTableHeaderCell>Última actualización</DataTableHeaderCell>
            </DataTableHeader>
            <tbody>
              {executions.map((execution) => {
                const href = `/dashboard/admin/sequence-executions/${execution.id}`;
                const label =
                  execution.name ?? `Borrador creado el ${new Date(execution.createdAt).toLocaleDateString('es-CL')}`;
                return (
                  <ClickableTableRow key={execution.id} href={href} ariaLabel={`Abrir gestión ${label}`}>
                    <td className="px-4 py-3">
                      <PrimaryItemLink href={href}>{label}</PrimaryItemLink>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{execution.executiveName}</td>
                    <td className="px-4 py-3 text-slate-600">{execution.clientName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{execution.domainName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{execution.mailboxEmail}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {execution.templateName} (v{execution.templateVersionNumber})
                    </td>
                    <td className="px-4 py-3 text-slate-600">{execution.prospectCount ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(execution.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(execution.requestedAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(execution.receivedAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(execution.startedAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{STATUS_LABELS[execution.status] ?? execution.status}</td>
                    <td className="px-4 py-3 text-slate-600">{execution.serverStatus ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {execution.initialProspectState
                        ? PROSPECT_STATE_LABELS[execution.initialProspectState] ?? execution.initialProspectState
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(execution.lastSyncedAt)}</td>
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
