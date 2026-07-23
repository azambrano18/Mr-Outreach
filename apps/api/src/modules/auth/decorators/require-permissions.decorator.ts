import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_METADATA_KEY = 'permissions';

/**
 * Declares which permission keys a route requires. Read by
 * PermissionsGuard — the guard is what actually enforces this, so routes
 * stay declarative and the check always happens on the backend, never
 * only in the frontend.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_METADATA_KEY, permissions);
