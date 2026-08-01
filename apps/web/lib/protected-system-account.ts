/**
 * UI-only mirror of apps/api's domain/user/protected-system-account.ts — used
 * solely to hide the "Eliminar" action for this account. It is NOT the real
 * protection: the backend rejects the deletion independently and
 * unconditionally, even if this check were ever bypassed or removed here.
 */
const PROTECTED_ADMIN_EMAIL = 'sistema@mejoreferido.cl';

export function isProtectedSystemAccount(email: string): boolean {
  return email.trim().toLowerCase() === PROTECTED_ADMIN_EMAIL;
}
