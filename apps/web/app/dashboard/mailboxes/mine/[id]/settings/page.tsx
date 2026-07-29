import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { AssigneeSummary, AssignedMailboxSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../../../lib/api';
import { getCurrentUser } from '../../../../../../lib/session';

/**
 * Fase Firma — the signature no longer belongs to the mailbox: it moved
 * into each Plantilla's own editor (§11 of the account-restructuring
 * follow-up). This screen no longer shows a "Firma" tab at all.
 */
type SettingsTab = 'general' | 'connection' | 'assignments' | 'limits' | 'sync' | 'diagnostics';

const TAB_LABEL: Record<SettingsTab, string> = {
  general: 'General',
  connection: 'Conexión',
  assignments: 'Asignaciones',
  limits: 'Límites de envío',
  sync: 'Sincronización',
  diagnostics: 'Estado y diagnóstico',
};

const CONNECTION_LABEL: Record<AssignedMailboxSummary['connectionStatus'], string> = {
  NOT_TESTED: 'Sin probar',
  TESTING: 'Probando…',
  CONNECTED: 'Conectada',
  PARTIALLY_CONNECTED: 'Conexión parcial',
  CONNECTION_ERROR: 'Error de conexión',
  ENGINE_UNAVAILABLE: 'Motor no disponible',
};

function tabHref(mailboxId: string, tab: SettingsTab): string {
  return `/dashboard/mailboxes/mine/${mailboxId}/settings?tab=${tab}`;
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <p className="text-sm text-slate-800">{value}</p>
    </div>
  );
}

function PendingSection({ description }: { description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
      {description}
    </div>
  );
}

export default async function MyMailboxSettingsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('mailboxes.read.assigned')) {
    redirect('/dashboard/mailboxes/mine');
  }

  // Assignment scoping lives here, not in the API: this page only proceeds
  // when the requested mailbox actually shows up in /me/mailboxes — same
  // pattern already used by the self-service inbox page.
  const myMailboxes = await apiFetch<AssignedMailboxSummary[]>('/me/mailboxes');
  const mailbox = myMailboxes.find((candidate) => candidate.id === params.id);
  if (!mailbox) {
    notFound();
  }

  const tabParam = searchParams.tab as SettingsTab | undefined;
  const tab: SettingsTab = tabParam && tabParam in TAB_LABEL ? tabParam : 'general';

  let assignees: AssigneeSummary[] = [];
  if (tab === 'assignments' || tab === 'diagnostics') {
    try {
      assignees = await apiFetch<AssigneeSummary[]>(`/me/mailboxes/${params.id}/assignees`);
    } catch {
      assignees = [];
    }
  }

  const visibleTabs: SettingsTab[] = ['general', 'connection', 'assignments', 'limits', 'sync', 'diagnostics'];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/mailboxes/mine"
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            ← Volver a mis cuentas de correo
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            Configuración de {mailbox.name}
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {visibleTabs.map((tabKey) => (
          <Link
            key={tabKey}
            href={tabHref(mailbox.id, tabKey)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === tabKey
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {TAB_LABEL[tabKey]}
          </Link>
        ))}
      </div>

      {tab === 'general' && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
          <InfoField label="Nombre identificador" value={mailbox.name} />
          <InfoField label="Correo (solo lectura)" value={mailbox.email} />
          <InfoField label="Nombre visible del remitente" value={mailbox.fromName} />
          <InfoField label="Reply-To" value={mailbox.replyTo ?? '—'} />
          <InfoField
            label="Estado operativo"
            value={mailbox.status === 'ACTIVE' ? 'Operativa' : 'Inactiva'}
          />
          <InfoField label="Zona horaria" value="No disponible en esta fase" />
          <p className="col-span-full text-xs text-slate-400">
            La edición de estos datos, límites de envío, sincronización y credenciales corresponde
            al administrador. La firma de tus correos se configura dentro de cada Plantilla, no aquí.
          </p>
        </div>
      )}

      {tab === 'connection' && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
          <InfoField
            label="Estado de conexión"
            value={CONNECTION_LABEL[mailbox.connectionStatus]}
          />
          <InfoField
            label="Última validación"
            value={
              mailbox.lastTestedAt ? new Date(mailbox.lastTestedAt).toLocaleString('es-CL') : '—'
            }
          />
          <InfoField label="Último resultado" value={mailbox.lastTestMessage ?? '—'} />
          <p className="col-span-full text-xs text-slate-400">
            Probar IMAP/SMTP, enviar un correo de prueba y actualizar credenciales requieren
            permisos de administrador sobre la cuenta.
          </p>
        </div>
      )}

      {tab === 'assignments' && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5">
          {assignees.length === 0 ? (
            <p className="text-sm text-slate-500">No hay ejecutivos asignados a esta cuenta.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {assignees.map((assignee) => (
                <li
                  key={assignee.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"
                >
                  <span>
                    {assignee.name} <span className="text-slate-400">· {assignee.email}</span>
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {assignee.role === 'PRIMARY' ? 'Principal' : 'Secundario'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-400">
            Agregar, retirar o cambiar el responsable principal requiere permisos de administrador.
          </p>
        </div>
      )}

      {tab === 'limits' && (
        <PendingSection description="Los límites de envío (límite diario, enviados hoy, intervalos y horarios permitidos) todavía no tienen un modelo de datos propio — no disponible en esta fase." />
      )}

      {tab === 'sync' && (
        <PendingSection description="La sincronización IMAP en segundo plano (worker, carpetas sincronizadas, errores recientes) todavía no existe — la bandeja de esta fase lee directamente del motor en cada visita, sin sincronización de fondo." />
      )}

      {tab === 'diagnostics' && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:grid-cols-2">
          <InfoField
            label="Estado general"
            value={mailbox.status === 'ACTIVE' ? 'Operativa' : 'Inactiva'}
          />
          <InfoField label="IMAP / SMTP" value={CONNECTION_LABEL[mailbox.connectionStatus]} />
          <InfoField
            label="Asignaciones"
            value={`${assignees.length} ejecutivo${assignees.length === 1 ? '' : 's'}`}
          />
          <InfoField label="Capacidad disponible" value="No disponible en esta fase" />
          <InfoField
            label="Último error"
            value={mailbox.lastTestMessage ?? 'Sin errores recientes'}
          />
        </div>
      )}
    </div>
  );
}
