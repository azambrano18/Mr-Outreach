import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { ConstructionState } from '../construction-state';

/**
 * There is no standalone signatures list yet — a signature belongs to a
 * single mailbox and is managed from its edit page
 * (/dashboard/mailboxes/[id]/edit) or viewed read-only from
 * /dashboard/mailboxes/mine/[id]/signature. This is a placeholder for the
 * future dedicated "Firmas" screen.
 */
export default async function SignaturesPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('signatures.read')) {
    return <AccessDenied />;
  }

  return (
    <ConstructionState
      title="Firmas"
      description="Este módulo se encuentra en construcción. Mientras tanto, administra la firma de cada cuenta desde su ficha de edición."
    />
  );
}
