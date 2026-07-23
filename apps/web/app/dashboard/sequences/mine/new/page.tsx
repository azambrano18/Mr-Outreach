import { redirect } from 'next/navigation';
import type { ConversationTreeClientNode, ManagedClientSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../../lib/api';
import { getCurrentUser } from '../../../../../lib/session';
import { AccessDenied } from '../../../access-denied';
import { SequenceWizard } from '../../../../../components/sequences/wizard/sequence-wizard';

/** §1-27 — "Crear secuencia": the 7-step wizard. Client/mailbox options come from the same assigned-only tree the "Cuentas de correos" screen already uses. */
export default async function NewSequencePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('sequences.manage.own')) {
    return <AccessDenied />;
  }

  const [clients, tree] = await Promise.all([
    apiFetch<ManagedClientSummary[]>('/me/clients'),
    apiFetch<ConversationTreeClientNode[]>('/me/conversations/tree'),
  ]);

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Crear secuencia</h1>
        <p className="text-sm text-slate-500">
          Configura el cliente, la cuenta remitente, los contactos y los 3 steps de envío.
        </p>
      </div>
      <SequenceWizard clients={clients} tree={tree} />
    </div>
  );
}
