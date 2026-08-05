import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
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
  let clientExecutiveAssignments: jest.Mocked<ClientExecutiveAssignmentRepository>;
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

  const adminRole: Role = { ...executiveRole, id: 'role_admin', name: 'ADMIN' };

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
      findByEmailIncludingDeleted: jest.fn(),
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
    clientExecutiveAssignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByClient: jest.fn(),
      findByUser: jest.fn().mockResolvedValue([]),
      ensureDerivedVisibility: jest.fn(),
      removeDerivedVisibilityIfPresent: jest.fn(),
    };

    service = new UsersService(
      users,
      roles,
      userRoles,
      auditLogs,
      mailboxAssignments,
      sequenceExecutions,
      clientExecutiveAssignments,
    );
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

    describe('restore-on-create (reusing a soft-deleted user’s email)', () => {
      it('restores the same userId instead of inserting a new row: clears deletedAt, sets ACTIVE, assigns the selected role, generates a new temporary password, forces mustChangePassword, clears stale client assignments, and audits user.restored', async () => {
        roles.findById.mockResolvedValue(executiveRole);
        const deletedUser = buildUser({
          id: 'user_1',
          status: 'INACTIVE',
          deletedAt: new Date('2026-08-03T18:28:52.180Z'),
          mustChangePassword: false,
          passwordChangedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        users.findByEmailIncludingDeleted.mockResolvedValue(deletedUser);
        users.update.mockImplementation(async (_id, patch) => ({ ...deletedUser, ...patch }) as User);
        userRoles.getRolesForUser.mockResolvedValueOnce([{ ...executiveRole, id: 'role_old' }]);
        clientExecutiveAssignments.findByUser.mockResolvedValueOnce([
          { id: 'a1', organizationId: orgId, clientId: 'client_1', userId: 'user_1', role: 'SECONDARY', visibilitySource: 'MANUAL', assignedBy: 'someone', assignedAt: new Date() },
        ]);

        const result = await service.create(
          orgId,
          { firstName: 'Alejandro', lastName: 'Zambrano', email: 'exec@example.com', roleId: 'role_exec' },
          'admin_1',
        );

        expect(users.create).not.toHaveBeenCalled();
        expect(users.update).toHaveBeenCalledWith(
          'user_1',
          expect.objectContaining({ status: 'ACTIVE', mustChangePassword: true, passwordChangedAt: null, deletedAt: null }),
        );
        expect(result.id).toBe('user_1');
        expect(result.restored).toBe(true);
        expect(typeof result.temporaryPassword).toBe('string');
        expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(16);

        expect(userRoles.unassign).toHaveBeenCalledWith('user_1', 'role_old');
        expect(userRoles.assign).toHaveBeenCalledWith('user_1', executiveRole.id);

        expect(clientExecutiveAssignments.remove).toHaveBeenCalledWith('client_1', 'user_1');

        expect(auditLogs.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'user.restored', entityId: 'user_1', organizationId: orgId, actorId: 'admin_1' }),
        );
        const auditCall = auditLogs.record.mock.calls.find((call) => call[0].action === 'user.restored')?.[0];
        expect(JSON.stringify(auditCall)).not.toContain(result.temporaryPassword);
      });

      it('rejects with a clear conflict when the email already belongs to an ACTIVE user', async () => {
        roles.findById.mockResolvedValue(executiveRole);
        users.findByEmailIncludingDeleted.mockResolvedValue(buildUser({ status: 'ACTIVE', deletedAt: null }));

        await expect(
          service.create(orgId, { firstName: 'A', lastName: 'B', email: 'exec@example.com', roleId: 'role_exec' }, 'admin_1'),
        ).rejects.toThrow(ConflictException);
        expect(users.create).not.toHaveBeenCalled();
        expect(users.update).not.toHaveBeenCalled();
      });

      it('rejects with a message pointing to the profile when the email belongs to an INACTIVE (not deleted) user', async () => {
        roles.findById.mockResolvedValue(executiveRole);
        users.findByEmailIncludingDeleted.mockResolvedValue(buildUser({ status: 'INACTIVE', deletedAt: null }));

        await expect(
          service.create(orgId, { firstName: 'A', lastName: 'B', email: 'exec@example.com', roleId: 'role_exec' }, 'admin_1'),
        ).rejects.toThrow(/actívalo desde su perfil/i);
        expect(users.create).not.toHaveBeenCalled();
        expect(users.update).not.toHaveBeenCalled();
      });

      it('never restores a deleted user belonging to a different organization — creates a brand new one in the current organization instead', async () => {
        roles.findById.mockResolvedValue(executiveRole);
        // findByEmailIncludingDeleted is already org-scoped — a different org's deleted user is simply never found.
        users.findByEmailIncludingDeleted.mockResolvedValue(null);
        const created = buildUser({ id: 'user_new', mustChangePassword: true });
        users.create.mockResolvedValue(created);

        const result = await service.create(
          orgId,
          { firstName: 'A', lastName: 'B', email: 'exec@example.com', roleId: 'role_exec' },
          'admin_1',
        );

        expect(users.findByEmailIncludingDeleted).toHaveBeenCalledWith(orgId, 'exec@example.com');
        expect(users.create).toHaveBeenCalled();
        expect(users.update).not.toHaveBeenCalled();
        expect(result.restored).toBe(false);
      });

      it('creating a fresh sistema@mejoreferido.cl (no existing row at all) is unaffected by the restore guard — protection is enforced elsewhere (setStatus/update/remove), not by blocking its creation', async () => {
        roles.findById.mockResolvedValue(executiveRole);
        users.findByEmailIncludingDeleted.mockResolvedValue(null);
        const created = buildUser({ id: 'user_sistema', email: 'sistema@mejoreferido.cl', mustChangePassword: true });
        users.create.mockResolvedValue(created);

        const result = await service.create(
          orgId,
          { firstName: 'Sistema', lastName: 'Principal', email: 'sistema@mejoreferido.cl', roleId: 'role_exec' },
          'admin_1',
        );

        expect(users.create).toHaveBeenCalled();
        expect(result.restored).toBe(false);
      });

      it('defense in depth: never restores a soft-deleted row whose email matches the protected system account, even though remove() already makes that state unreachable in practice', async () => {
        roles.findById.mockResolvedValue(executiveRole);
        const deletedSistema = buildUser({
          id: 'user_sistema',
          email: 'sistema@mejoreferido.cl',
          status: 'INACTIVE',
          deletedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        users.findByEmailIncludingDeleted.mockResolvedValue(deletedSistema);

        await expect(
          service.create(
            orgId,
            { firstName: 'A', lastName: 'B', email: 'sistema@mejoreferido.cl', roleId: 'role_exec' },
            'admin_1',
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(users.update).not.toHaveBeenCalled();
      });

      it('matches the protected system account’s email case-insensitively and trimming whitespace, blocking the restore', async () => {
        roles.findById.mockResolvedValue(executiveRole);
        const deletedSistema = buildUser({
          id: 'user_sistema',
          email: 'sistema@mejoreferido.cl',
          status: 'INACTIVE',
          deletedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        users.findByEmailIncludingDeleted.mockResolvedValue(deletedSistema);

        await expect(
          service.create(
            orgId,
            { firstName: 'A', lastName: 'B', email: '  Sistema@MejoReferido.CL  ', roleId: 'role_exec' },
            'admin_1',
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(users.update).not.toHaveBeenCalled();
      });
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

    it('rejects changing the protected system account’s email — renaming it would silently disable every other protection, which is matched by email, never by id', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl' }));

      await expect(
        service.update(orgId, 'user_1', { email: 'atacante@example.com' }, 'actor_1'),
      ).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('allows re-submitting the protected system account’s own email unchanged (case/whitespace variants included)', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl' }));
      users.update.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl' }));

      await expect(
        service.update(orgId, 'user_1', { email: '  Sistema@MejoReferido.CL  ' }, 'actor_1'),
      ).resolves.toBeDefined();
    });

    it('rejects reassigning the protected system account away from the ADMIN role', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl' }));
      roles.findById.mockResolvedValue(executiveRole);

      await expect(
        service.update(orgId, 'user_1', { roleId: executiveRole.id }, 'actor_1'),
      ).rejects.toThrow(ForbiddenException);
      expect(userRoles.unassign).not.toHaveBeenCalled();
      expect(userRoles.assign).not.toHaveBeenCalled();
    });

    it('allows re-assigning the protected system account to the ADMIN role (a no-op in practice, but never blocked)', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl' }));
      users.update.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl' }));
      roles.findById.mockResolvedValue(adminRole);

      await expect(
        service.update(orgId, 'user_1', { roleId: adminRole.id }, 'actor_1'),
      ).resolves.toBeDefined();
      expect(userRoles.assign).toHaveBeenCalledWith('user_1', adminRole.id);
    });

    it('other admins can still change their email and role normally — the protection is exclusive to the protected system account', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'otro.admin@example.com' }));
      users.update.mockResolvedValue(buildUser({ email: 'nuevo@example.com' }));
      roles.findById.mockResolvedValue(executiveRole);

      await expect(
        service.update(orgId, 'user_1', { email: 'nuevo@example.com', roleId: executiveRole.id }, 'actor_1'),
      ).resolves.toBeDefined();
    });
  });

  describe('setStatus', () => {
    it('deactivates a user and records the audit action', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      users.findAll.mockResolvedValue([buildUser(), buildUser({ id: 'other_admin' })]);

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

    /**
     * The last-active-admin invariant used to only be checked at deletion
     * time. Since deletion now requires the user be INACTIVE already (see
     * `remove`), deactivation is the point where the organization could
     * actually be left with zero active admins — so this is where the
     * protection now has to live.
     */
    it('blocks deactivating an ADMIN when they are the organization’s last active admin', async () => {
      users.findById.mockResolvedValue(buildUser());
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);
      users.findAll.mockResolvedValue([buildUser()]);

      await expect(service.setStatus(orgId, 'user_1', 'INACTIVE', 'actor_1')).rejects.toThrow(ConflictException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('allows deactivating an ADMIN when another active admin remains', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);
      users.findAll.mockResolvedValue([buildUser(), buildUser({ id: 'other_admin' })]);
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);

      await expect(service.setStatus(orgId, 'user_1', 'INACTIVE', 'actor_1')).resolves.toBeDefined();
    });

    it('allows deactivating a non-admin executive regardless of the organization’s admin count', async () => {
      users.findById.mockResolvedValue(buildUser());
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE' }));

      await expect(service.setStatus(orgId, 'user_1', 'INACTIVE', 'actor_1')).resolves.toBeDefined();
      expect(users.findAll).not.toHaveBeenCalled();
    });

    it('never re-checks the last-active-admin rule when deactivating an already-INACTIVE user', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE' }));

      await service.setStatus(orgId, 'user_1', 'INACTIVE', 'actor_1');

      expect(users.findAll).not.toHaveBeenCalled();
    });

    it('rejects deactivating the protected system account, unconditionally — even as the caller with users.disable', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl' }));

      await expect(service.setStatus(orgId, 'user_1', 'INACTIVE', 'actor_1')).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('rejects deactivating the protected system account matched case-insensitively and trimming whitespace', async () => {
      users.findById.mockResolvedValue(buildUser({ email: '  Sistema@MejoReferido.CL  ' }));

      await expect(service.setStatus(orgId, 'user_1', 'INACTIVE', 'actor_1')).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('never blocks reactivating the protected system account (status ACTIVE is always safe)', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl', status: 'INACTIVE' }));
      users.update.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl', status: 'ACTIVE' }));

      await expect(service.setStatus(orgId, 'user_1', 'ACTIVE', 'actor_1')).resolves.toBeDefined();
    });

    it('other admins can still be deactivated normally — the protection is exclusive to the protected system account', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'otro.admin@example.com' }));
      users.update.mockResolvedValue(buildUser({ email: 'otro.admin@example.com', status: 'INACTIVE' }));
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);
      users.findAll.mockResolvedValue([buildUser(), buildUser({ id: 'other_admin' })]);
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);

      await expect(service.setStatus(orgId, 'user_1', 'INACTIVE', 'actor_1')).resolves.toBeDefined();
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
    /**
     * ACTIVE -> INACTIVE -> DELETED is now mandatory (never ACTIVE -> DELETED
     * directly) — every test below that expects a successful deletion uses
     * an already-INACTIVE fixture; this test is the one that specifically
     * proves the ACTIVE case is rejected, with a controlled domain error,
     * before anything else is even checked.
     */
    it('rejects deleting a user who is still ACTIVE, regardless of role — must be deactivated first', async () => {
      users.findById.mockResolvedValue(buildUser());

      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(ConflictException);
      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(/desactivarse/);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('soft-deletes an already-INACTIVE executive with no dependencies and audits the action', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE', deletedAt: new Date() }));

      await service.remove(orgId, 'user_1', 'actor_1');

      expect(users.update).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ status: 'INACTIVE', deletedAt: expect.any(Date) }),
      );
      expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.delete' }));
    });

    it('allows deleting an already-INACTIVE admin regardless of how many other active admins exist — the last-active-admin rule is enforced at deactivation time (setStatus), not here', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE', deletedAt: new Date() }));
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);

      await expect(service.remove(orgId, 'user_1', 'actor_1')).resolves.toBeUndefined();
      // Confirms the (now unreachable-in-practice) admin-count check is genuinely skipped for an INACTIVE target.
      expect(users.findAll).not.toHaveBeenCalled();
    });

    it('rejects deleting the protected system account even while ACTIVE, case-insensitively and trimming whitespace', async () => {
      users.findById.mockResolvedValue(buildUser({ email: '  Sistema@MejoReferido.CL  ' }));

      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('an INACTIVE admin (not the protected system account) can still be soft-deleted normally', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'otro.admin@example.com', status: 'INACTIVE' }));
      users.update.mockResolvedValue(buildUser({ email: 'otro.admin@example.com', status: 'INACTIVE', deletedAt: new Date() }));
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);

      await service.remove(orgId, 'user_1', 'actor_1');

      expect(users.update).toHaveBeenCalledWith(
        'user_1',
        expect.objectContaining({ status: 'INACTIVE', deletedAt: expect.any(Date) }),
      );
    });

    it('rejects an admin deleting their own account even while ACTIVE', async () => {
      users.findById.mockResolvedValue(buildUser({ id: 'actor_1' }));

      await expect(service.remove(orgId, 'actor_1', 'actor_1')).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('blocks deletion when the (already-INACTIVE) executive is still PRIMARY on a mailbox', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      mailboxAssignments.findByUser.mockResolvedValue([buildAssignment({ role: 'PRIMARY' })]);

      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(ConflictException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('blocks deletion when the (already-INACTIVE) executive owns a non-terminal Gestión', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      sequenceExecutions.findByExecutive.mockResolvedValue([buildExecution({ status: 'RUNNING' })]);

      await expect(service.remove(orgId, 'user_1', 'actor_1')).rejects.toThrow(ConflictException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('allows deletion when every owned Gestión is already terminal', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
      users.update.mockResolvedValue(buildUser({ status: 'INACTIVE', deletedAt: new Date() }));
      sequenceExecutions.findByExecutive.mockResolvedValue([
        buildExecution({ status: 'COMPLETED' }),
        buildExecution({ id: 'execution_2', status: 'FAILED' }),
      ]);

      await expect(service.remove(orgId, 'user_1', 'actor_1')).resolves.toBeUndefined();
    });

    it('removes SECONDARY mailbox assignments as part of deletion', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));
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

  describe('getDeletionImpact', () => {
    it('reports a clean, already-INACTIVE executive as deletable with zero counts', async () => {
      users.findById.mockResolvedValue(buildUser({ status: 'INACTIVE' }));

      const impact = await service.getDeletionImpact(orgId, 'user_1', 'actor_1');

      expect(impact).toEqual({
        roleName: 'EXECUTIVE',
        isProtectedSystemAccount: false,
        isSelf: false,
        mustDeactivateFirst: false,
        isLastActiveAdmin: false,
        primaryMailboxCount: 0,
        secondaryMailboxCount: 0,
        activeExecutionCount: 0,
        canDelete: true,
      });
    });

    it('flags mustDeactivateFirst and sets canDelete to false while the user is still ACTIVE', async () => {
      users.findById.mockResolvedValue(buildUser());

      const impact = await service.getDeletionImpact(orgId, 'user_1', 'actor_1');

      expect(impact.mustDeactivateFirst).toBe(true);
      expect(impact.canDelete).toBe(false);
    });

    it('flags isSelf and sets canDelete to false when previewing one’s own account', async () => {
      users.findById.mockResolvedValue(buildUser({ id: 'actor_1' }));

      const impact = await service.getDeletionImpact(orgId, 'actor_1', 'actor_1');

      expect(impact.isSelf).toBe(true);
      expect(impact.canDelete).toBe(false);
    });

    it('flags isProtectedSystemAccount and sets canDelete to false for sistema@mejoreferido.cl', async () => {
      users.findById.mockResolvedValue(buildUser({ email: 'sistema@mejoreferido.cl' }));

      const impact = await service.getDeletionImpact(orgId, 'user_1', 'actor_1');

      expect(impact.isProtectedSystemAccount).toBe(true);
      expect(impact.canDelete).toBe(false);
    });

    it('flags isLastActiveAdmin and sets canDelete to false when no other active admin exists', async () => {
      users.findById.mockResolvedValue(buildUser());
      userRoles.getRolesForUser.mockResolvedValueOnce([adminRole]);
      users.findAll.mockResolvedValue([buildUser()]);

      const impact = await service.getDeletionImpact(orgId, 'user_1', 'actor_1');

      expect(impact.isLastActiveAdmin).toBe(true);
      expect(impact.canDelete).toBe(false);
    });

    it('reports real mailbox/gestión counts and sets canDelete to false while any block remains', async () => {
      users.findById.mockResolvedValue(buildUser());
      mailboxAssignments.findByUser.mockResolvedValue([
        buildAssignment({ role: 'PRIMARY' }),
        buildAssignment({ mailboxId: 'mailbox_2', role: 'SECONDARY' }),
      ]);
      sequenceExecutions.findByExecutive.mockResolvedValue([buildExecution({ status: 'RUNNING' })]);

      const impact = await service.getDeletionImpact(orgId, 'user_1', 'actor_1');

      expect(impact.primaryMailboxCount).toBe(1);
      expect(impact.secondaryMailboxCount).toBe(1);
      expect(impact.activeExecutionCount).toBe(1);
      expect(impact.canDelete).toBe(false);
    });
  });
});
