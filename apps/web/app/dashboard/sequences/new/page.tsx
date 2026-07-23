import { redirect } from 'next/navigation';
import type { AdminClientsListResult, ManagedClientSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import { SequenceWizard } from '../../../../components/sequences/wizard/sequence-wizard';

/** Spec §3 — admin creates a sequence and assigns it to any ACTIVE executive; see SequenceWizard's mode="admin". */
export default async function NewAdminSequencePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('sequences.assign')) {
    return <AccessDenied />;
  }

  const [overview, managedClients] = await Promise.all([
    apiFetch<AdminClientsListResult>('/clients/crm-overview'),
    apiFetch<ManagedClientSummary[]>('/clients'),
  ]);
  const activeManagedClientIds = new Set(
    managedClients.filter((client) => client.status === 'ACTIVE').map((client) => client.id),
  );
  const clients = overview.clients
    .filter(
      (client) =>
        client.configurationStatus === 'CONFIGURADO' &&
        client.managedClientId &&
        activeManagedClientIds.has(client.managedClientId),
    )
    .map((client) => ({ id: client.managedClientId as string, name: client.name }));

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Nueva secuencia</h1>
        <p className="text-sm text-slate-500">
          Configura el cliente, la cuenta remitente, el ejecutivo responsable, los contactos y los 3 steps de
          envío.
        </p>
      </div>
      <SequenceWizard clients={clients} mode="admin" />
    </div>
  );
}
