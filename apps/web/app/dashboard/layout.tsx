import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/session';
import { AdminShell } from './admin-shell';

const CHANGE_PASSWORD_PATH = '/dashboard/change-password';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const pathname = headers().get('x-pathname') ?? '';
  const isChangePasswordPage = pathname === CHANGE_PASSWORD_PATH;

  // A pending forced password change blocks every other dashboard screen —
  // mirrors the backend's PermissionsGuard, which blocks every other API
  // route the same way. change-password itself renders standalone, without
  // the dashboard chrome, since the rest of the app isn't reachable yet.
  if (user.mustChangePassword && !isChangePasswordPage) {
    redirect(CHANGE_PASSWORD_PATH);
  }

  if (isChangePasswordPage) {
    return <>{children}</>;
  }

  return (
    <AdminShell userName={user.name} userEmail={user.email} permissions={user.permissions}>
      {children}
    </AdminShell>
  );
}
