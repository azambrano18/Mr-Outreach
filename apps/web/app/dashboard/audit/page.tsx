import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { ConstructionState } from '../construction-state';

/**
 * The audit log is recorded internally (AuditLogRepository) but there is
 * no read endpoint or screen for it yet. Placeholder until that API and
 * screen are built.
 */
export default async function AuditPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  if (!currentUser.permissions.includes('audit.read')) {
    return <AccessDenied />;
  }

  return (
    <ConstructionState title="Auditoría" description="Este módulo se encuentra en construcción." />
  );
}
