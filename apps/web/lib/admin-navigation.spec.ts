import { adminNavigation, isNavItemVisible, resolveActiveNavItem, resolvePageTitle } from './admin-navigation';

const ADMIN_PERMISSIONS = ['mailboxes.read.all'];
const EXECUTIVE_PERMISSIONS = ['mailboxes.read.assigned'];

function visibleFor(permissions: string[]) {
  return adminNavigation.filter((item) => isNavItemVisible(item, permissions));
}

describe('resolveActiveNavItem / resolvePageTitle (administrador)', () => {
  const visible = visibleFor(ADMIN_PERMISSIONS);

  it('"Conversaciones" and the admin "Cuentas de Correos" item both match /dashboard/mailboxes/mine by prefix alone — the overlap this bug was about actually exists in the data', () => {
    const rawMatches = visible.filter((item) => resolveActiveNavItem([item], '/dashboard/mailboxes/mine') !== null);
    expect(rawMatches.map((item) => item.label).sort()).toEqual(['Conversaciones', 'Cuentas de Correos']);
  });

  it('resolves exactly Conversaciones as active on /dashboard/mailboxes/mine (the redirect target of /dashboard/conversations), never both', () => {
    const active = resolveActiveNavItem(visible, '/dashboard/mailboxes/mine');
    expect(active?.label).toBe('Conversaciones');
    expect(resolvePageTitle('/dashboard/mailboxes/mine', ADMIN_PERMISSIONS)).toBe('Conversaciones');
  });

  it('resolves exactly Cuentas de Correos as active on /dashboard/mailboxes', () => {
    const active = resolveActiveNavItem(visible, '/dashboard/mailboxes');
    expect(active?.label).toBe('Cuentas de Correos');
    expect(resolvePageTitle('/dashboard/mailboxes', ADMIN_PERMISSIONS)).toBe('Cuentas de Correos');
  });

  it('resolves exactly Cuentas de Correos as active on /dashboard/mailboxes/link', () => {
    const active = resolveActiveNavItem(visible, '/dashboard/mailboxes/link');
    expect(active?.label).toBe('Cuentas de Correos');
    expect(resolvePageTitle('/dashboard/mailboxes/link', ADMIN_PERMISSIONS)).toBe('Cuentas de Correos');
  });

  it('resolves exactly Cuentas de Correos as active on /dashboard/mailboxes/:id/edit', () => {
    const active = resolveActiveNavItem(visible, '/dashboard/mailboxes/abc123/edit');
    expect(active?.label).toBe('Cuentas de Correos');
    expect(resolvePageTitle('/dashboard/mailboxes/abc123/edit', ADMIN_PERMISSIONS)).toBe('Cuentas de Correos');
  });

  it('resolves Inicio for the dashboard root without consulting any nav item', () => {
    expect(resolvePageTitle('/dashboard', ADMIN_PERMISSIONS)).toBe('Inicio');
  });
});

describe('resolveActiveNavItem (ejecutivo)', () => {
  it('the executive only ever sees its own scoped items — no admin-only item is even in the visible list to conflict with', () => {
    const visible = visibleFor(EXECUTIVE_PERMISSIONS);
    const cuentasDeCorreoItems = visible.filter((item) => item.label === 'Cuentas de Correos');
    expect(cuentasDeCorreoItems).toHaveLength(1);
    expect(cuentasDeCorreoItems[0].href).toBe('/dashboard/mail-accounts');
  });

  it('resolves the executive Cuentas de Correos item as active on its own route', () => {
    const visible = visibleFor(EXECUTIVE_PERMISSIONS);
    const active = resolveActiveNavItem(visible, '/dashboard/mail-accounts');
    expect(active?.label).toBe('Cuentas de Correos');
  });
});
