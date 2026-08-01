import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignment } from '../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Role } from '../../domain/role/role.entity';
import { RoleRepository } from '../../domain/role/role.repository';
import { SequenceExecution } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { UserRoleRepository } from '../../domain/user-role/user-role.repository';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let users: jest.Mocked<UserRepository>;
  let roles: jest.Mocked<RoleRepository>;
  let userRoles: jest.Mocked<UserRoleRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let mailboxAssignments: jest.Mocked<MailboxAssignmentRepository>;
  let sequenceExecutions: jest.Mocked<SequenceExecutionRepository>;
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
    mailboxAssignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByMailbox: jest.fn(),
      findByUser: jest.fn().mockResolvedValue([]),
      findAllByOrganization: jest.fn(),
    };
    sequenceExecutions = {
      findById: jest.fn(),
      findByServerExecutionId: jest.fn(),
      findByExecutive: jest.fn().mockResolvedValue([]),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      conditionalUpdateStatus: jest.fn(),
    };

    service = new UsersService(users, roles, userRoles, auditLogs, mailboxAssignments, sequenceExecutions);
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

    it('allows creating a user with the ADMIN role — the create-user flow can create admins too', async () => {
      const adminRole: Role = { ...executiveRole, id: 'role_admin', name: 'ADMIN' };
      roles.findById.mockResolvedValue(adminRole);
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);
      const created = buildUser({ mustChangePassword: true });
      users.create.mockResolvedValue(created);

      const result = await service.create(
        orgId,
        { firstName: 'Nueva', lastName: 'Admin', email: 'nueva.admin@example.com', roleId: 'role_admin' },
        'actor_1',
      );

      expect(userRoles.assign).toHaveBeenCalledWith(created.id, adminRole.id);
      expect(result.roleName).toBe('ADMIN');
    });

    it('rejects a custom/other role even when it exists and belongs to the same organization — only ADMIN or EXECUTIVE can be assigned through this endpoint, never a client-supplied roleId taken at face value', async () => {
      const customRole: Role = { ...executiveRole, id: 'role_custom', name: 'AUDITOR_EXTERNO' };
      roles.findById.mockResolvedValue(customRole);

      await expect(
        service.create(
          orgId,
          { firstName: 'Intento', lastName: 'DeCustom', email: 'intento@example.com', roleId: 'role_custom' },
          'actor_1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(users.create).not.toHaveBeenCalled();
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

  describe('remove', () => {
    const buildAssignment = (overrides: Partial<MailboxAssignment> = {}): MailboxAssignment => ({
      id: 'assignment_1',
      organizationId: orgId,
      mailboxId: 'mailbox_1',
      userId: 'user_1',
      role: 'SECONDARY',
      assignedBy: 'actor_1',
      assignedAt: new Date(),
      ...overrides,
    });

    const buildExecution = (overrides: Partial<SequenceExecution> = {}): SequenceExecution =>
      ({
        id: 'execution_1',
        organizationId: orgId,
        executiveId: 'user_1',
        mailboxId: 'mailbox_1',
        templateId: 'template_1',
        templateVersionId: 'template_version_1',
        name: null,
        timezone: 'America/Santiago',
        status: 'COMPLETED',
        ...overrides,
      }) as SequenceExecution;

    it('soft-deletes an executive with no dependencies and audits the action', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE', deletedAt: new Date() }));

      await service.remove(orgId, 'user_1', 'actor_1');

      expect(users.update).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ status: 'INACTIVE', deletedAt: expect.any(Date) }),
      );
      expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.delete' }));
    });

    it('rejects deleting a non-EXECUTIVE user (e.g. ADMIN)', async () => {
      users.findById.mockResolvedValue(buildUser());
      userRoles.getRolesForUser.mockResolvedValueOnce([{ ...executiveRole, name: 'ADMIN' }]);

      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(ConflictException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('blocks deletion when the executive is still PRIMARY on a mailbox', async () => {
      users.findById.mockResolvedValue(buildUser());
      mailboxAssignments.findByUser.mockResolvedValue([buildAssignment({ role: 'PRIMARY' })]);

      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(ConflictException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('blocks deletion when the executive owns a non-terminal Gestión', async () => {
      users.findById.mockResolvedValue(buildUser());
      sequenceExecutions.findByExecutive.mockResolvedValue([buildExecution({ status: 'RUNNING' })]);

      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(ConflictException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('allows deletion when every owned Gestión is already terminal', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE', deletedAt: new Date() }));
      sequenceExecutions.findByExecutive.mockResolvedValue([
        buildExecution({ status: 'COMPLETED' }),
        buildExecution({ id: 'execution_2', status: 'FAILED' }),
      ]);

      await expect(service.remove(orgId, 'user_1', 'actor_1')).resolves.toBeUndefined();
    });

    it('removes SECONDARY mailbox assignments as part of deletion', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE', deletedAt: new Date() }));
      mailboxAssignments.findByUser.mockResolvedValue([
        buildAssignment({ mailboxId: 'mailbox_1', role: 'SECONDARY' }),
        buildAssignment({ mailboxId: 'mailbox_2', role: 'SECONDARY' }),
      ]);

      await service.remove(orgId, 'user_1', 'actor_1');

      expect(mailboxAssignments.remove).toHaveBeenCalledWith('mailbox_1', 'user_1');
      expect(mailboxAssignments.remove).toHaveBeenCalledWith('mailbox_2', 'user_1');
    });

    it('throws NotFoundException for a user in a different organization', async () => {
      users.findById.mockResolvedValue(buildUser({ organizationId: otherOrgId }));

      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(NotFoundException);
    });
  });
});
