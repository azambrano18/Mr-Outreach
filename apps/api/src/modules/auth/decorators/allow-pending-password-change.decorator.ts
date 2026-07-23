import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';

/**
 * Marks a route as reachable even while the caller has `mustChangePassword`
 * pending — see PermissionsGuard, which otherwise blocks every other route.
 * Applied only to auth.me, auth.logout and auth.changePassword.
 */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);
