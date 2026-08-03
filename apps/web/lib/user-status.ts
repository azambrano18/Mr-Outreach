export type UserStatus = 'ACTIVE' | 'INACTIVE';

const KNOWN_USER_STATUSES: readonly UserStatus[] = ['ACTIVE', 'INACTIVE'];

/**
 * Runtime boundary validation for a value the API/shared TypeScript type
 * *claims* is a `UserStatus`. The declared type `'ACTIVE' | 'INACTIVE'` on
 * `UserSummary.status` is erased at runtime and never actually checks what
 * the API sent — a stale deploy, a serialization bug, a future third
 * status, or simply a missing field would all satisfy the compiler while
 * being `undefined`, `null`, or some unexpected string in practice.
 *
 * Returns `null` for anything that isn't EXACTLY one of the two known
 * values. Callers must treat `null` as "unknown" — never silently
 * downgrade it to "inactive" or "active". This is the fail-closed
 * building block `getExecutiveActionsVisibility` is built on: an unknown
 * status must never be able to enable a destructive action.
 */
export function parseUserStatus(value: unknown): UserStatus | null {
  return typeof value === 'string' && (KNOWN_USER_STATUSES as readonly string[]).includes(value)
    ? (value as UserStatus)
    : null;
}
