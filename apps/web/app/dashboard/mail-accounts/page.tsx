import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';

/**
 * "Cuentas de Correos" sidebar alias — executive-only. There is deliberately
 * no admin destination here anymore: the standalone cross-client mailbox
 * list was removed (see the admin-reorg follow-up spec, section 1) — admins
 * now manage mailboxes exclusively inside Cliente → Dominio → Cuenta. This
 * route only ever forwards an executive to their own assigned mailboxes.
 */
export default async function MailAccountsAliasPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (currentUser.permissions.includes('mailboxes.read.assigned')) {
    redirect('/dashboard/mailboxes/mine');
  }

  return <AccessDenied />;
}
