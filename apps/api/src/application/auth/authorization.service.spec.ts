import { Role } from '../../domain/role/role.entity';
import { RoleRepository } from '../../domain/role/role.repository';
import { UserRoleRepository } from '../../domain/user-role/user-role.repository';
import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  const role = (id: string, name: string): Role => ({
    id,
    organizationId: 'org_1',
    name,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('returns the union of permissions across every role assigned to the user, without duplicates', async () => {
    const userRoles: jest.Mocked<UserRoleRepository> = {
      assign: jest.fn(),
      unassign: jest.fn(),
      getRolesForUser: jest
        .fn()
        .mockResolvedValue([role('role_1', 'ADMIN'), role('role_2', 'AUDITOR')]),
    };
    const roles: jest.Mocked<RoleRepository> = {
      findById: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      setPermissions: jest.fn(),
      getPermissionKeys: jest
        .fn()
        .mockImplementation((roleId: string) =>
          Promise.resolve(
            roleId === 'role_1' ? ['users.read', 'users.create'] : ['audit.read', 'users.read'],
          ),
        ),
    };

    const service = new AuthorizationService(userRoles, roles);
    const permissions = await service.getPermissionKeysForUser('user_1');

    expect(permissions.sort()).toEqual(['audit.read', 'users.create', 'users.read'].sort());
  });

  it('returns an empty list for a user with no roles assigned', async () => {
    const userRoles: jest.Mocked<UserRoleRepository> = {
      assign: jest.fn(),
      unassign: jest.fn(),
      getRolesForUser: jest.fn().mockResolvedValue([]),
    };
    const roles: jest.Mocked<RoleRepository> = {
      findById: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      setPermissions: jest.fn(),
      getPermissionKeys: jest.fn(),
    };

    const service = new AuthorizationService(userRoles, roles);
    const permissions = await service.getPermissionKeysForUser('user_without_roles');

    expect(permissions).toEqual([]);
    expect(roles.getPermissionKeys).not.toHaveBeenCalled();
  });
});
