import { getExecutiveActionsVisibility } from './executive-action-visibility';

const ADMIN_TOKEN = { id: 'admin-1', permissions: ['users.disable', 'users.delete'] };

function executive(overrides: Partial<{ id: string; email: string; status: unknown }> = {}) {
  return {
    id: 'exec-1',
    email: 'ejecutivo@mejoreferido.cl',
    status: 'ACTIVE' as unknown,
    ...overrides,
  };
}

describe('getExecutiveActionsVisibility', () => {
  // -----------------------------------------------------------------
  // The two known, explicit states — independent checks, never one
  // derived as the negation of the other.
  // -----------------------------------------------------------------

  it('ACTIVE: shows Desactivar, never Activar nor Eliminar', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: 'ACTIVE' }), ADMIN_TOKEN);
    expect(visibility.isKnownStatus).toBe(true);
    expect(visibility.showDeactivate).toBe(true);
    expect(visibility.showActivate).toBe(false);
    expect(visibility.showDelete).toBe(false);
  });

  it('INACTIVE: shows Activar and Eliminar simultaneously, never Desactivar', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: 'INACTIVE' }), ADMIN_TOKEN);
    expect(visibility.isKnownStatus).toBe(true);
    expect(visibility.showActivate).toBe(true);
    expect(visibility.showDelete).toBe(true);
    expect(visibility.showDeactivate).toBe(false);
  });

  // -----------------------------------------------------------------
  // Fail-closed: any status that isn't EXACTLY 'ACTIVE' or 'INACTIVE'
  // must never enable any action — this is the exact incident being
  // guarded against (a loose "not ACTIVE = inactive" shortcut silently
  // treating an unrecognized value as eligible for a destructive action).
  // -----------------------------------------------------------------

  it('undefined status: shows no status action at all', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: undefined }), ADMIN_TOKEN);
    expect(visibility.isKnownStatus).toBe(false);
    expect(visibility.showActivate).toBe(false);
    expect(visibility.showDeactivate).toBe(false);
    expect(visibility.showDelete).toBe(false);
  });

  it('null status: shows no status action at all', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: null }), ADMIN_TOKEN);
    expect(visibility.isKnownStatus).toBe(false);
    expect(visibility.showActivate).toBe(false);
    expect(visibility.showDeactivate).toBe(false);
    expect(visibility.showDelete).toBe(false);
  });

  it('lowercase "inactive": never shows Eliminar (must match the exact uppercase contract)', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: 'inactive' }), ADMIN_TOKEN);
    expect(visibility.isKnownStatus).toBe(false);
    expect(visibility.showDelete).toBe(false);
    expect(visibility.showActivate).toBe(false);
  });

  it('an unrecognized string status never shows Eliminar', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: 'SUSPENDED' }), ADMIN_TOKEN);
    expect(visibility.isKnownStatus).toBe(false);
    expect(visibility.showDelete).toBe(false);
  });

  it('a non-string status (number) never shows Eliminar', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: 0 }), ADMIN_TOKEN);
    expect(visibility.isKnownStatus).toBe(false);
    expect(visibility.showDelete).toBe(false);
  });

  // -----------------------------------------------------------------
  // Exclusions — always evaluated in addition to a confirmed-INACTIVE status.
  // -----------------------------------------------------------------

  it('sistema@mejoreferido.cl never shows Eliminar, even while INACTIVE', () => {
    const visibility = getExecutiveActionsVisibility(
      executive({ email: 'sistema@mejoreferido.cl', status: 'INACTIVE' }),
      ADMIN_TOKEN,
    );
    expect(visibility.showDelete).toBe(false);
  });

  it('matches sistema@mejoreferido.cl case-insensitively and trimming whitespace, same as the backend', () => {
    const visibility = getExecutiveActionsVisibility(
      executive({ email: '  Sistema@MejoReferido.CL  ', status: 'INACTIVE' }),
      ADMIN_TOKEN,
    );
    expect(visibility.showDelete).toBe(false);
  });

  it('sistema@mejoreferido.cl never shows Desactivar, even while ACTIVE', () => {
    const visibility = getExecutiveActionsVisibility(
      executive({ email: 'sistema@mejoreferido.cl', status: 'ACTIVE' }),
      ADMIN_TOKEN,
    );
    expect(visibility.showDeactivate).toBe(false);
  });

  it('matches sistema@mejoreferido.cl case-insensitively and trimming whitespace for Desactivar too', () => {
    const visibility = getExecutiveActionsVisibility(
      executive({ email: '  Sistema@MejoReferido.CL  ', status: 'ACTIVE' }),
      ADMIN_TOKEN,
    );
    expect(visibility.showDeactivate).toBe(false);
  });

  it('a non-protected ACTIVE account still shows Desactivar normally — the exclusion is exclusive to the protected system account', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: 'ACTIVE' }), ADMIN_TOKEN);
    expect(visibility.showDeactivate).toBe(true);
  });

  it('never shows Eliminar for one’s own account, even while INACTIVE', () => {
    const visibility = getExecutiveActionsVisibility(executive({ id: 'admin-1', status: 'INACTIVE' }), ADMIN_TOKEN);
    expect(visibility.showDelete).toBe(false);
  });

  it('never shows Eliminar without the users.delete permission, even for a confirmed-INACTIVE target', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: 'INACTIVE' }), {
      id: 'admin-1',
      permissions: ['users.disable'],
    });
    expect(visibility.showDelete).toBe(false);
  });

  it('never shows Activar/Desactivar without the users.disable permission', () => {
    const visibility = getExecutiveActionsVisibility(executive({ status: 'ACTIVE' }), {
      id: 'admin-1',
      permissions: ['users.delete'],
    });
    expect(visibility.showDeactivate).toBe(false);
    const inactiveVisibility = getExecutiveActionsVisibility(executive({ status: 'INACTIVE' }), {
      id: 'admin-1',
      permissions: ['users.delete'],
    });
    expect(inactiveVisibility.showActivate).toBe(false);
  });

  it('showDelete never depends on any dependency/impact information — the function takes none, by design (the backend is the only place that checks and rejects those)', () => {
    // The type signature itself is the proof: getExecutiveActionsVisibility
    // accepts only (executive, currentUser) — there is no third parameter
    // for mailbox assignments, active Gestiones, or any other blocker a
    // caller could use to suppress the button. A confirmed-INACTIVE,
    // eligible target always resolves to showDelete=true regardless of how
    // many dependencies it might actually have — only the backend's own
    // UsersService.remove() decides whether the DELETE call itself
    // succeeds, and it rejects with a specific, readable error when it doesn't.
    const visibility = getExecutiveActionsVisibility(executive({ status: 'INACTIVE' }), ADMIN_TOKEN);
    expect(visibility.showDelete).toBe(true);
  });
});
