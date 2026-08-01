import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignment } from '../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox, MailboxLinkStatus } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SequenceExecution, SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { DeleteMailboxUseCase } from './delete-mailbox.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('DeleteMailboxUseCase', () => {
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let sequenceExecutions: jest.Mocked<SequenceExecutionRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let useCase: DeleteMailboxUseCase;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const buildMailbox = (overrides: Partial<Mailbox> = {}): Mailbox =>
    ({
      id: 'mailbox_1',
      organizationId: orgId,
      email: 'ventas@example.com',
      linkStatus: 'REVOKED' as MailboxLinkStatus,
      ...overrides,
    }) as Mailbox;

  const buildExecution = (overrides: Partial<SequenceExecution> = {}): SequenceExecution =>
    ({
      id: 'execution_1',
      organizationId: orgId,
      mailboxId: 'mailbox_1',
      status: 'COMPLETED' as SequenceExecutionStatus,
      ...overrides,
    }) as SequenceExecution;

  const buildAssignment = (overrides: Partial<MailboxAssignment> = {}): MailboxAssignment => ({
    id: 'assignment_1',
    organizationId: orgId,
    mailboxId: 'mailbox_1',
    userId: 'user_1',
    role: 'SECONDARY',
    assignedBy: 'admin_1',
    assignedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    mailboxes = {
      findById: jest.fn().mockResolvedValue(buildMailbox()),
      findByEmail: jest.fn(),
      findByServerMailboxId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      createLinked: jest.fn(),
      update: jest.fn(),
    };
    assignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByMailbox: jest.fn().mockResolvedValue([]),
      findByUser: jest.fn(),
      findAllByOrganization: jest.fn(),
    };
    sequenceExecutions = {
      findById: jest.fn(),
      findByServerExecutionId: jest.fn(),
      findByExecutive: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      conditionalUpdateStatus: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };

    useCase = new DeleteMailboxUseCase(
      new FakeTransactionManager(),
      mailboxes,
      assignments,
      sequenceExecutions,
      auditLogs,
    );
  });

  it('soft-deletes a REVOKED mailbox with no dependencies and audits the action', async () => {
    await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });

    expect(mailboxes.update).toHaveBeenCalledWith(
      'mailbox_1',
      { deletedAt: expect.any(Date) },
      expect.anything(),
    );
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mailbox.delete', entityId: 'mailbox_1' }),
      expect.anything(),
    );
  });

  it('rejects deleting a mailbox that is not REVOKED yet', async () => {
    mailboxes.findById.mockResolvedValue(buildMailbox({ linkStatus: 'ACTIVE' }));

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
    ).rejects.toThrow(ConflictException);
    expect(mailboxes.update).not.toHaveBeenCalled();
  });

  it('blocks deletion when the mailbox owns a non-terminal Gestión', async () => {
    sequenceExecutions.findAllByOrganization.mockResolvedValue([buildExecution({ status: 'RUNNING' })]);

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
    ).rejects.toThrow(ConflictException);
    expect(mailboxes.update).not.toHaveBeenCalled();
  });

  it('allows deletion when every Gestión for this mailbox is already terminal', async () => {
    sequenceExecutions.findAllByOrganization.mockResolvedValue([
      buildExecution({ status: 'COMPLETED' }),
      buildExecution({ id: 'execution_2', status: 'FAILED' }),
    ]);

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
    ).resolves.toBeUndefined();
  });

  it('ignores non-terminal Gestiones that belong to a different mailbox', async () => {
    sequenceExecutions.findAllByOrganization.mockResolvedValue([
      buildExecution({ mailboxId: 'mailbox_other', status: 'RUNNING' }),
    ]);

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
    ).resolves.toBeUndefined();
  });

  it('removes every remaining assignment as part of the deletion', async () => {
    assignments.findByMailbox.mockResolvedValue([
      buildAssignment({ userId: 'user_1', role: 'PRIMARY' }),
      buildAssignment({ userId: 'user_2', role: 'SECONDARY' }),
    ]);

    await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });

    expect(assignments.remove).toHaveBeenCalledWith('mailbox_1', 'user_1', expect.anything());
    expect(assignments.remove).toHaveBeenCalledWith('mailbox_1', 'user_2', expect.anything());
  });

  it('throws NotFoundException for a mailbox in a different organization', async () => {
    mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the mailbox does not exist', async () => {
    mailboxes.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'missing', actorId: 'admin_1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
