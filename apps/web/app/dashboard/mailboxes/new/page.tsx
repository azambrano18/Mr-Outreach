import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../../lib/session';
import { CreateMailboxForm } from './create-mailbox-form';

export default async function NewMailboxPage({
  searchParams,
}: {
  searchParams: { domainId?: string; clientId?: string };
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }
  if (!currentUser.permissions.includes('mailboxes.create')) {
    redirect('/dashboard/clients');
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Registrar cuenta de correo</h1>
      <CreateMailboxForm domainId={searchParams.domainId} clientId={searchParams.clientId} />
    </div>
  );
}
