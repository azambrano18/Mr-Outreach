import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../lib/session';
import { AccessDenied } from '../access-denied';
import { IntegrationMonitorClient } from './integration-monitor-client';

/**
 * §37-40 — "Monitor de integración". Simulation-mode only in spirit (the
 * spec gates it to "modo simulación + usuarios autorizados") — the
 * `simulation.manage` permission is what the advance/reprocess actions
 * require server-side; this page itself only needs read permissions to
 * render the Resumen/Comandos/Eventos tabs.
 */
export default async function IntegrationMonitorPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect('/login');
  }

  const canRead =
    currentUser.permissions.includes('integration_commands.read') ||
    currentUser.permissions.includes('integration_events.read');
  if (!canRead) {
    return <AccessDenied />;
  }

  return (
    <IntegrationMonitorClient canManage={currentUser.permissions.includes('simulation.manage')} />
  );
}
