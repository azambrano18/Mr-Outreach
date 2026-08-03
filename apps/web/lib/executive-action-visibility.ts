import { isProtectedSystemAccount } from './protected-system-account';
import { parseUserStatus } from './user-status';

export interface ExecutiveForVisibility {
  id: string;
  email: string;
  /**
   * Deliberately `unknown`, not `UserStatus` — this function never trusts
   * the caller's TypeScript type alone (see parseUserStatus's own
   * comment). Whatever the API actually sent is validated internally.
   */
  status: unknown;
}

export interface CurrentUserForVisibility {
  id: string;
  permissions: string[];
}

export interface ExecutiveActionsVisibility {
  /** False whenever `status` isn't exactly `'ACTIVE'` or `'INACTIVE'` — every action below is then forced to `false`, regardless of permissions. */
  isKnownStatus: boolean;
  /** True only when the account is confirmed ACTIVE and the caller can disable accounts. */
  showDeactivate: boolean;
  /** True only when the account is confirmed INACTIVE and the caller can disable accounts. */
  showActivate: boolean;
  /**
   * True only when the account is confirmed INACTIVE — never derived as
   * "not active". The flow is always ACTIVE -> INACTIVE -> DELETED; an
   * unknown status is neither ACTIVE nor INACTIVE and must never satisfy
   * this condition (fail-closed).
   *
   * Deliberately ignorant of dependencies (mailboxes assigned as
   * principal/secundario, gestiones activas, etc.) — "Eliminar" is always
   * OFFERED to an eligible (confirmed-inactive, non-protected, not-self)
   * target; only the backend actually knows and enforces those
   * dependencies, rejecting the request with a specific, readable domain
   * error when they exist. Hiding the button based on a guess here would
   * just make a real blocker invisible instead of explained.
   */
  showDelete: boolean;
}

/**
 * Single source of truth for which account-lifecycle actions the
 * Ejecutivos detail page shows for a given executive/current-user pair.
 * Pure — no fetch, no React — so it can be unit-tested directly (see
 * executive-action-visibility.spec.ts) without rendering anything.
 *
 * Fail-closed by construction: `isActive`/`isInactive` are two
 * INDEPENDENT, explicit equality checks against the validated status —
 * never one derived as the negation of the other. A status that is
 * neither (unknown/missing/legacy) makes both false, which makes every
 * action in the returned object false too. This is what makes it
 * structurally impossible for an unrecognized status value to enable
 * "Eliminar" (or any other action) — the previous incident was exactly a
 * `!isActive` shortcut silently treating "not ACTIVE" as "INACTIVE".
 */
export function getExecutiveActionsVisibility(
  executive: ExecutiveForVisibility,
  currentUser: CurrentUserForVisibility,
): ExecutiveActionsVisibility {
  const status = parseUserStatus(executive.status);
  const isActive = status === 'ACTIVE';
  const isInactive = status === 'INACTIVE';

  const isSelf = executive.id === currentUser.id;
  const isProtected = isProtectedSystemAccount(executive.email);
  const canDisable = currentUser.permissions.includes('users.disable');
  const canDelete = currentUser.permissions.includes('users.delete');

  return {
    isKnownStatus: status !== null,
    showDeactivate: canDisable && isActive,
    showActivate: canDisable && isInactive,
    showDelete: canDelete && !isProtected && !isSelf && isInactive,
  };
}
