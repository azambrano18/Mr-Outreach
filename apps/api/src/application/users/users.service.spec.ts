import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Role } from '../../domain/role/role.entity';
import { RoleRepository } from '../../domain/role/role.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { UserRoleRepository } from '../../domain/user-role/user-role.repository';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let users: jest.Mocked<UserRepository>;
  let roles: jest.Mocked<RoleRepository>;
  let userRoles: jest.Mocked<UserRoleRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let service: UsersService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const executiveRole: Role = {
    id: 'role_exec',
    organizationId: orgId,
    name: 'EXECUTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buildUser = (overrides: Partial<User> = {}): User => ({
    id: 'user_1',
    organizationId: orgId,
    firstName: 'Ejecutivo',
    lastName: 'Demo',
    email: 'exec@example.com',
    passwordHash: 'hash',
    status: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    users = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailAnyOrganization: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    roles = {
      findById: jest.fn(),
      findByName: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      setPermissions: jest.fn(),
      getPermissionKeys: jest.fn(),
    };
    userRoles = {
      assign: jest.fn(),
      unassign: jest.fn(),
      getRolesForUser: jest.fn().mockResolvedValue([executiveRole]),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };

    service = new UsersService(users, roles, userRoles, auditLogs);
  });

  describe('create', () => {
    it('creates the user with a generated password, assigns the role, forces mustChangePassword, and audits the action', async () => {
      roles.findById.mockResolvedValue(executiveRole);
      const created = buildUser({ mustChangePassword: true });
      users.create.mockResolvedValue(created);

      const result = await service.create(
        orgId,
        {
          firstName: 'Ejecutivo',
          lastName: 'Demo',
          email: 'exec@example.com',
          roleId: 'role_exec',
        },
        'actor_1',
      );

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: orgId, email: 'exec@example.com', mustChangePassword: true }),
      );
      const passedHash = users.create.mock.calls[0][0].passwordHash;
      expect(typeof passedHash).toBe('string');
      expect(passedHash.length).toBeGreaterThan(0);
      expect(userRoles.assign).toHaveBeenCalledWith(created.id, executiveRole.id);
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.create' }),
      );
      expect(result.roleName).toBe('EXECUTIVE');
      expect(typeof result.temporaryPassword).toBe('string');
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(16);
      // Never logged/audited — confirm the raw temp password never appears in the audit call.
      const auditCall = auditLogs.record.mock.calls[0][0];
      expect(JSON.stringify(auditCall)).not.toContain(result.temporaryPassword);
    });

    it('rejects a role that does not exist', async () => {
      roles.findById.mockResolvedValue(null);

      await expect(
        service.create(orgId, { firstName: 'A', lastName: 'B', email: 'a@example.com', roleId: 'missing' }, 'actor_1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a role that belongs to a different organization', async () => {
      roles.findById.mockResolvedValue({ ...executiveRole, organizationId: otherOrgId });

      await expect(
        service.create(orgId, { firstName: 'A', lastName: 'B', email: 'a@example.com', roleId: 'role_exec' }, 'actor_1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    it('generates a new temporary password, forces mustChangePassword, and audits without leaking the password', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ mustChangePassword: true }));

      const result = await service.resetPassword(orgId, 'user_1', 'actor_1');

      expect(users.update).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ mustChangePassword: true, passwordChangedAt: null }),
      );
      expect(result.email).toBe('exec@example.com');
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(16);
      const auditCall = auditLogs.record.mock.calls[0][0];
      expect(auditCall.action).toBe('user.reset_password');
      expect(JSON.stringify(auditCall)).not.toContain(result.temporaryPassword);
    });

    it('throws NotFoundException for a user in a different organization', async () => {
      users.findById.mockResolvedValue(buildUser({ organizationId: otherOrgId }));

      await expect(service.resetPassword(orgId, 'user_1', 'actor_1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates only the fields provided, never overwriting with undefined', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ firstName: 'New', lastName: 'Name' }));

      await service.update(orgId, 'user_1', { firstName: 'New', lastName: 'Name' }, 'actor_1');

      expect(users.update).toHaveBeenCalledWith('user_1', { firstName: 'New', lastName: 'Name' });
    });

    it('reassigns the role when roleId is provided: unassigns old roles, assigns the new one', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser());
      roles.findById.mockResolvedValue({ ...executiveRole, id: 'role_admin', name: 'ADMIN' });

      await service.update(orgId, 'user_1', { roleId: 'role_admin' }, 'actor_1');

      expect(userRoles.unassign).toHaveBeenCalledWith('user_1', executiveRole.id);
      expect(userRoles.assign).toHaveBeenCalledWith('user_1', 'role_admin');
    });

    it('throws NotFoundException for a user in a different organization (never 403)', async () => {
      users.findById.mockResolvedValue(buildUser({ organizationId: otherOrgId }));

      await expect(service.update(orgId, 'user_1', { firstName: 'X' }, 'actor_1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a user id that does not exist at all', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.update(orgId, 'missing', { firstName: 'X' }, 'actor_1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setStatus', () => {
    it('deactivates a user and records the audit action', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE' }));

      const result = await service.setStatus(orgId, 'user_1', 'INACTIVE', 'actor_1');

      expect(users.update).toHaveBeenCalledWith('user_1', { status: 'INACTIVE' });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.deactivate' }),
      );
      expect(result.status).toBe('INACTIVE');
    });

    it('reactivates a user and records the audit action', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      users.update.mockResolvedValue(buildUser({ status: 'ACTIVE' }));

      await service.setStatus(orgId, 'user_1', 'ACTIVE', 'actor_1');

      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.activate' }),
      );
    });
  });

  describe('list / getById', () => {
    it('lists users scoped to the organization with their role name resolved', async () => {
      users.findAll.mockResolvedValue([buildUser()]);

      const result = await service.list(orgId);

      expect(users.findAll).toHaveBeenCalledWith(orgId);
      expect(result[0].roleName).toBe('EXECUTIVE');
    });

    it('getById never returns a user from a different organization', async () => {
      users.findById.mockResolvedValue(buildUser({ organizationId: otherOrgId }));

      await expect(service.getById(orgId, 'user_1')).rejects.toThrow(NotFoundException);
    });
  });
});
