import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { UserRepository } from '../../domain/user/user.repository';
import { RemoveMailboxAssignmentsAfterUnlinkUseCase } from './remove-mailbox-assignments-after-unlink.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('RemoveMailboxAssignmentsAfterUnlinkUseCase', () => {
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findById'>>;
  let assignments: jest.Mocked<Pick<MailboxAssignmentRepository, 'findByMailbox' | 'remove'>>;
  let users: jest.Mocked<Pick<UserRepository, 'findById'>>;
  let auditLogs: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let useCase: RemoveMailboxAssignmentsAfterUnlinkUseCase;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';
  const revokedMailbox = {
    id: 'mailbox_1',
    organizationId: orgId,
    email: 'ventas@example.com',
    linkStatus: 'REVOKED',
    revocationId: 'rev_1',
  };

  const primaryUser = { id: 'exec_1', organizationId: orgId, firstName: 'Ana', lastName: 'Gómez', email: 'ana@example.com' };
  const secondaryUser = { id: 'exec_2', organizationId: orgId, firstName: 'Beto', lastName: 'Ruiz', email: 'beto@example.com' };

  beforeEach(() => {
    mailboxes = { findById: jest.fn().mockResolvedValue(revokedMailbox) };
    assignments = {
      findByMailbox: jest.fn().mockResolvedValue([
        { id: 'a1', mailboxId: 'mailbox_1', userId: 'exec_1', role: 'PRIMARY' },
        { id: 'a2', mailboxId: 'mailbox_1', userId: 'exec_2', role: 'SECONDARY' },
      ]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    users = {
      findById: jest.fn().mockImplementation(async (id: string) => {
        if (id === 'exec_1') return primaryUser;
        if (id === 'exec_2') return secondaryUser;
        return null;
      }),
    };
    auditLogs = { record: jest.fn().mockResolvedValue(undefined) };

    useCase = new RemoveMailboxAssignmentsAfterUnlinkUseCase(
      new FakeTransactionManager(),
      mailboxes as never,
      assignments as never,
      users as never,
      auditLogs as never,
    );
  });

  it('removes the primary and every secondary assignment', async () => {
    const result = await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });

    expect(assignments.remove).toHaveBeenCalledWith('mailbox_1', 'exec_1', { kind: 'fake' });
    expect(assignments.remove).toHaveBeenCalledWith('mailbox_1', 'exec_2', { kind: 'fake' });
    expect(assignments.remove).toHaveBeenCalledTimes(2);
    expect(result.assignmentsRemoved).toBe(2);
    expect(result.primaryRemoved).toEqual({ id: 'exec_1', name: 'Ana Gómez', email: 'ana@example.com' });
    expect(result.secondaryRemoved).toEqual([{ id: 'exec_2', name: 'Beto Ruiz', email: 'beto@example.com' }]);
  });

  it('never touches the User rows themselves — only the MailboxAssignment join', async () => {
    await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });

    // The repository mock exposes no delete/update/deactivate method at all —
    // the use case can only ever call findById on it.
    expect(Object.keys(users)).toEqual(['findById']);
  });

  it('records exactly one audit entry, naming the removed executives, never claiming they were deleted', async () => {
    await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1', correlationId: 'corr_x' });

    expect(auditLogs.record).toHaveBeenCalledTimes(1);
    const [entry] = auditLogs.record.mock.calls[0]!;
    expect(entry).toEqual(
      expect.objectContaining({
        organizationId: orgId,
        actorId: 'admin_1',
        action: 'mailbox.assignments_removed_after_unlink',
        entityType: 'Mailbox',
        entityId: 'mailbox_1',
        metadata: expect.objectContaining({
          email: 'ventas@example.com',
          actorUserId: 'admin_1',
          primaryRemoved: { id: 'exec_1', name: 'Ana Gómez', email: 'ana@example.com' },
          secondaryRemoved: [{ id: 'exec_2', name: 'Beto Ruiz', email: 'beto@example.com' }],
          assignmentsRemoved: 2,
          correlationId: 'corr_x',
          result: 'SUCCESS',
        }),
      }),
    );
    expect(JSON.stringify(entry)).not.toMatch(/delet|deactivat/i);
  });

  it('is idempotent: a mailbox with no assignments left is a silent no-op with no audit entry', async () => {
    assignments.findByMailbox.mockResolvedValue([]);

    const result = await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });

    expect(result).toEqual({ mailboxId: 'mailbox_1', assignmentsRemoved: 0, primaryRemoved: null, secondaryRemoved: [] });
    expect(assignments.remove).not.toHaveBeenCalled();
    expect(auditLogs.record).not.toHaveBeenCalled();
  });

  it('refuses to run before the mailbox is REVOKED', async () => {
    mailboxes.findById.mockResolvedValue({ ...revokedMailbox, linkStatus: 'UNLINK_REQUESTED' } as never);

    await expect(useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' })).rejects.toThrow(
      ConflictException,
    );
    expect(assignments.remove).not.toHaveBeenCalled();
  });

  it('404s for a mailbox in a different organization — never leaks its existence', async () => {
    mailboxes.findById.mockResolvedValue({ ...revokedMailbox, organizationId: otherOrgId } as never);

    await expect(useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('never touches assignments belonging to a different mailbox', async () => {
    await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });

    expect(assignments.findByMailbox).toHaveBeenCalledWith('mailbox_1', { kind: 'fake' });
    expect(assignments.findByMailbox).not.toHaveBeenCalledWith('some-other-mailbox', expect.anything());
  });
});
