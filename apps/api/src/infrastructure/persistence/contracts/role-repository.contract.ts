import { RoleRepository } from '../../../domain/role/role.repository';

export function runRoleRepositoryContractTests(
  getRepository: () => RoleRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('creates a role with its initial permission set', async () => {
    const repo = getRepository();
    const role = await repo.create({
      organizationId: 'org_1',
      name: 'ADMIN',
      permissionKeys: ['users.read', 'users.create'],
    });

    const keys = await repo.getPermissionKeys(role.id);

    expect(keys.sort()).toEqual(['users.create', 'users.read']);
  });

  it('enforces role name uniqueness within an organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', name: 'ADMIN', permissionKeys: [] });

    await expect(
      repo.create({ organizationId: 'org_1', name: 'ADMIN', permissionKeys: [] }),
    ).rejects.toThrow();
  });

  it('allows the same role name in two different organizations', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', name: 'ADMIN', permissionKeys: [] });

    const secondOrgRole = await repo.create({
      organizationId: 'org_2',
      name: 'ADMIN',
      permissionKeys: [],
    });

    expect(secondOrgRole).toBeDefined();
  });

  it('replaces the permission set via setPermissions', async () => {
    const repo = getRepository();
    const role = await repo.create({
      organizationId: 'org_1',
      name: 'EXECUTIVE',
      permissionKeys: ['templates.read'],
    });

    await repo.setPermissions(role.id, ['mailboxes.read.assigned']);
    const keys = await repo.getPermissionKeys(role.id);

    expect(keys).toEqual(['mailboxes.read.assigned']);
  });

  it('scopes findAll to the given organization', async () => {
    const repo = getRepository();
    await repo.create({ organizationId: 'org_1', name: 'ADMIN', permissionKeys: [] });
    await repo.create({ organizationId: 'org_2', name: 'ADMIN', permissionKeys: [] });

    const orgOneRoles = await repo.findAll('org_1');

    expect(orgOneRoles).toHaveLength(1);
  });
}
