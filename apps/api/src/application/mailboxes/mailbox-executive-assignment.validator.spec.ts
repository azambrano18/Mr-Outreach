import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../domain/user/user.repository';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';

describe('MailboxExecutiveAssignmentValidator', () => {
  let users: jest.Mocked<Pick<UserRepository, 'findById'>>;
  let validator: MailboxExecutiveAssignmentValidator;

  const orgId = 'org_1';
  const clientId = 'client_1';

  beforeEach(() => {
    users = { findById: jest.fn() };
    validator = new MailboxExecutiveAssignmentValidator(users as unknown as UserRepository);

    users.findById.mockResolvedValue({ id: 'exec_1', organizationId: orgId, status: 'ACTIVE' } as never);
  });

  describe('plan()', () => {
    it('normalizes null/undefined primary to null', () => {
      expect(validator.plan(undefined, undefined)).toEqual({ primaryExecutiveId: null, secondaryExecutiveIds: [] });
    });

    it('dedupes secondary ids', () => {
      expect(validator.plan(null, ['a', 'b', 'a']).secondaryExecutiveIds).toEqual(['a', 'b']);
    });

    it('rejects a primary duplicated in the secondary list instead of silently dropping it', () => {
      expect(() => validator.plan('exec_1', ['exec_2', 'exec_1'])).toThrow(BadRequestException);
    });
  });

  describe('validate()', () => {
    it('passes for an active executive, with no prior client visibility required', async () => {
      await expect(
        validator.validate({ organizationId: orgId, clientId, primaryExecutiveId: 'exec_1', secondaryExecutiveIds: [] }),
      ).resolves.toBeUndefined();
    });

    it('validates every id in the union of primary + secondary, never re-checking the same id twice', async () => {
      await validator.validate({ organizationId: orgId, clientId, primaryExecutiveId: 'exec_1', secondaryExecutiveIds: ['exec_2'] });
      expect(users.findById).toHaveBeenCalledTimes(2); // exec_1 once (deduped), exec_2 once
    });

    it('404s for a nonexistent executive', async () => {
      users.findById.mockResolvedValue(null);
      await expect(
        validator.validate({ organizationId: orgId, clientId, primaryExecutiveId: 'ghost' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s (never a different status) for an executive belonging to another organization — does not reveal cross-tenant existence', async () => {
      users.findById.mockResolvedValue({ id: 'exec_1', organizationId: 'other_org', status: 'ACTIVE' } as never);
      await expect(
        validator.validate({ organizationId: orgId, clientId, primaryExecutiveId: 'exec_1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('409s for an inactive executive', async () => {
      users.findById.mockResolvedValue({ id: 'exec_1', organizationId: orgId, status: 'INACTIVE' } as never);
      await expect(
        validator.validate({ organizationId: orgId, clientId, primaryExecutiveId: 'exec_1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('accepts an optional TransactionContext and forwards it to the user repository', async () => {
      const ctx = { kind: 'fake' } as never;
      await validator.validate({ organizationId: orgId, clientId, primaryExecutiveId: 'exec_1' }, ctx);
      expect(users.findById).toHaveBeenCalledWith('exec_1', ctx);
    });

    it('"Capacidades operativas del administrador" — accepts an admin user assigning themselves, using only org membership + active status as criteria (the `User` entity carries no role field at all; system role is resolved via UserRole, never checked here)', async () => {
      users.findById.mockResolvedValue({ id: 'admin_1', organizationId: orgId, status: 'ACTIVE' } as never);
      await expect(
        validator.validate({ organizationId: orgId, clientId, primaryExecutiveId: 'admin_1', secondaryExecutiveIds: [] }),
      ).resolves.toBeUndefined();
    });
  });
});
