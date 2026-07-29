import { redirect } from 'next/navigation';
import type { AssignedMailboxSummary } from '@outreach/shared-types';
import { apiFetch } from '../../../../lib/api';
import { getCurrentUser } from '../../../../lib/session';
import { AccessDenied } from '../../access-denied';
import { NewSequenceTemplateForm } from './new-sequence-template-form';

export default async function NewSequenceTemplatePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  if (!currentUser.permissions.includes('sequence_templates.create_own')) {
    return <AccessDenied />;
  }

  const mailboxes = await apiFetch<AssignedMailboxSummary[]>('/me/mailboxes');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 py-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Nueva plantilla</h1>
        <p className="text-sm text-slate-500">
          Elige la cuenta de correo que usará esta plantilla — no podrá cambiarse después de creada.
        </p>
      </div>
      <NewSequenceTemplateForm mailboxes={mailboxes} />
    </div>
  );
}
