const CHANGE_PASSWORD_PATH = '/dashboard/change-password';
const DASHBOARD_PATH = '/dashboard';

export interface UserForPostLoginDestination {
  mustChangePassword: boolean;
}

/**
 * Pure — no navigation, no fetch. Mirrors the same rule DashboardLayout
 * enforces server-side (see apps/web/app/dashboard/layout.tsx): a pending
 * forced password change always goes to change-password first. Kept
 * separate from the login page so the decision is unit-testable without
 * mounting a component or mocking next/navigation.
 */
export function getPostLoginDestination(user: UserForPostLoginDestination): string {
  return user.mustChangePassword ? CHANGE_PASSWORD_PATH : DASHBOARD_PATH;
}
