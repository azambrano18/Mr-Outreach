/**
 * `sistema@mejoreferido.cl` is the protected root administrator: it can
 * never be deleted through any path (UI, API, or a hand-crafted request),
 * regardless of how many other admins exist. Deliberately matched by email,
 * never by id — an id is environment-specific (differs between staging and
 * production) and would silently stop protecting the account after a
 * reseed/migration. The comparison is case-insensitive and trims
 * accidental whitespace so `" Sistema@MejoReferido.CL "` is still caught.
 */
const PROTECTED_ADMIN_EMAIL = 'sistema@mejoreferido.cl';

export function isProtectedSystemAccount(email: string): boolean {
  return email.trim().toLowerCase() === PROTECTED_ADMIN_EMAIL;
}
