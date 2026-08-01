/**
 * Technical names of the two system roles every organization must have.
 * Shared by permission-catalog.ts (which pairs each with its permission
 * key set), the seed/bootstrap scripts under prisma/, and any API code
 * that needs to check a role by name instead of trusting a client-supplied
 * roleId at face value (see UsersService.create).
 */
export const ADMIN_ROLE_NAME = 'ADMIN';
export const EXECUTIVE_ROLE_NAME = 'EXECUTIVE';
export const SYSTEM_ROLE_NAMES = [ADMIN_ROLE_NAME, EXECUTIVE_ROLE_NAME] as const;
