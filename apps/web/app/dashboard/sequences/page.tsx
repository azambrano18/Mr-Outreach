import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';

/**
 * "Secuencias" sidebar alias — same pattern as app/dashboard/mail-accounts:
 * a single nav entry that forwards to the admin global monitoring panel
 * (spec §4) or the executive's own self-service list, based on which
 * permission the user actually holds. No /dashboard/admin/* prefix.
 */
export default async function SequencesAliasPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  // /dashboard/sequences/all was retired along with the CRM-backed client
  // overview it depended on — its modern equivalent is "Monitor de gestiones".
  if (currentUser.permissions.includes('sequences.read_all')) {
    redirect('/dashboard/admin/sequence-executions');
  }
  // Etapa "cuenta del ejecutivo" — el módulo "Secuencias" quedó retirado de
  // la experiencia del ejecutivo; su equivalente seguro es "Plantillas".
  if (currentUser.permissions.includes('sequences.manage.own')) {
    redirect('/dashboard/sequence-templates');
  }

  return <AccessDenied />;
}
