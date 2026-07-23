import { InMemoryRoleRepository } from './in-memory-role.repository';
import { InMemoryUserRoleRepository } from './in-memory-user-role.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryUserRoleRepository', () => {
  it('assigns a role to a user and lists it back', async () => {
    const store = new MemoryStore();
    const roles = new InMemoryRoleRepository(store);
    const userRoles = new InMemoryUserRoleRepository(store);

    const role = await roles.create({ organizationId: 'org_1', name: 'ADMIN', permissionKeys: [] });
    await userRoles.assign('user_1', role.id);

    const assigned = await userRoles.getRolesForUser('user_1');

    expect(assigned).toHaveLength(1);
    expect(assigned[0].name).toBe('ADMIN');
  });

  it('unassign removes exactly that role, leaving others intact', async () => {
    const store = new MemoryStore();
    const roles = new InMemoryRoleRepository(store);
    const userRoles = new InMemoryUserRoleRepository(store);

    const adminRole = await roles.create({
      organizationId: 'org_1',
      name: 'ADMIN',
      permissionKeys: [],
    });
    const auditorRole = await roles.create({
      organizationId: 'org_1',
      name: 'AUDITOR',
      permissionKeys: [],
    });
    await userRoles.assign('user_1', adminRole.id);
    await userRoles.assign('user_1', auditorRole.id);

    await userRoles.unassign('user_1', adminRole.id);
    const remaining = await userRoles.getRolesForUser('user_1');

    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('AUDITOR');
  });

  it('returns an empty list for a user with no roles assigned', async () => {
    const store = new MemoryStore();
    const userRoles = new InMemoryUserRoleRepository(store);

    expect(await userRoles.getRolesForUser('nobody')).toEqual([]);
  });
});
