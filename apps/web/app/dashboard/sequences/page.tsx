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

  if (currentUser.permissions.includes('sequences.read_all')) {
    redirect('/dashboard/sequences/all');
  }
  if (currentUser.permissions.includes('sequences.manage.own')) {
    redirect('/dashboard/sequences/mine');
  }

  return <AccessDenied />;
}
