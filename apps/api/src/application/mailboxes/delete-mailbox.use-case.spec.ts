import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignment } from '../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox, MailboxLinkStatus } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SequenceExecution, SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SignatureAssetStoragePort } from '../../domain/signature-asset-storage/signature-asset-storage.port';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
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
  let storage: jest.Mocked<Pick<SignatureAssetStoragePort, 'deleteObjectsByPrefix'>>;
  let config: Pick<AppConfigService, 'r2SignaturePrefix'>;
  let useCase: DeleteMailboxUseCase;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const buildMailbox = (overrides: Partial<Mailbox> = {}): Mailbox =>
    ({
      id: 'mailbox_1',
      organizationId: orgId,
      email: 'ventas@example.com',
      linkStatus: 'REVOKED' as MailboxLinkStatus,
      assetCleanupStatus: 'NOT_NEEDED',
      assetCleanupAttempts: 0,
      lastAssetCleanupError: null,
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
      findByIdIncludingDeleted: jest.fn(),
      findByEmail: jest.fn(),
      findByServerMailboxId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      createLinked: jest.fn(),
      update: jest.fn().mockImplementation(async (id: string, patch: Partial<Mailbox>) => {
        const base = (await mailboxes.findById(id)) ?? buildMailbox();
        return { ...base, ...patch };
      }),
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
      conditionalUpdateStatusFromAllowed: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    storage = { deleteObjectsByPrefix: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
    config = { r2SignaturePrefix: 'firmas' };

    useCase = new DeleteMailboxUseCase(
      new FakeTransactionManager(),
      mailboxes,
      assignments,
      sequenceExecutions,
      auditLogs,
      storage as unknown as SignatureAssetStoragePort,
      config as unknown as AppConfigService,
    );
  });

  it('soft-deletes a REVOKED mailbox with no dependencies, audits the action, and marks cleanup PENDING then COMPLETED', async () => {
    await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });

    expect(mailboxes.update).toHaveBeenCalledWith(
      'mailbox_1',
      { deletedAt: expect.any(Date), assetCleanupStatus: 'PENDING' },
      expect.anything(),
    );
    expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', { assetCleanupStatus: 'COMPLETED' });
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mailbox.delete', entityId: 'mailbox_1' }),
      expect.anything(),
    );
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mailbox.asset_cleanup_completed', entityId: 'mailbox_1' }),
    );
  });

  it('Fase 2 (R2) — purges exactly firmas/{correo-normalizado}/ via deleteObjectsByPrefix', async () => {
    await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });
    expect(storage.deleteObjectsByPrefix).toHaveBeenCalledWith('firmas/ventas@example.com/');
  });

  it('Fase 2 (R2) — normalizes the mailbox email (trim/lowercase) before building the prefix', async () => {
    mailboxes.findById.mockResolvedValue(buildMailbox({ email: '  Ventas@Example.COM  ' }));
    await useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' });
    expect(storage.deleteObjectsByPrefix).toHaveBeenCalledWith('firmas/ventas@example.com/');
  });

  it('Fase 2 (R2) — a failed R2 purge still lets the mailbox finish deleting, but marks cleanup FAILED with the error persisted', async () => {
    storage.deleteObjectsByPrefix.mockRejectedValue(new Error('R2 unreachable'));

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
    ).resolves.toBeUndefined();

    expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', {
      assetCleanupStatus: 'FAILED',
      assetCleanupAttempts: 1,
      lastAssetCleanupError: 'R2 unreachable',
    });
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mailbox.asset_cleanup_failed', entityId: 'mailbox_1' }),
    );
  });

  it('rejects deleting a mailbox that is not REVOKED yet', async () => {
    mailboxes.findById.mockResolvedValue(buildMailbox({ linkStatus: 'ACTIVE' }));

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
    ).rejects.toThrow(ConflictException);
    expect(mailboxes.update).not.toHaveBeenCalled();
    expect(storage.deleteObjectsByPrefix).not.toHaveBeenCalled();
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

  /**
   * Idempotency §7 — once a mailbox is truly deleted (deletedAt persisted),
   * every read path including `findById` stops returning it, so a repeated
   * DELETE call reaches this exact branch: a controlled 404, never a
   * second soft-delete, never a second R2 purge, never a duplicate
   * `mailbox.delete`/`mailbox.asset_cleanup_completed` audit entry.
   */
  it('a repeated delete on an already-deleted mailbox never re-runs the soft-delete, the audit, or the R2 purge', async () => {
    mailboxes.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({ organizationId: orgId, mailboxId: 'mailbox_1', actorId: 'admin_1' }),
    ).rejects.toThrow(NotFoundException);

    expect(mailboxes.update).not.toHaveBeenCalled();
    expect(auditLogs.record).not.toHaveBeenCalled();
    expect(storage.deleteObjectsByPrefix).not.toHaveBeenCalled();
  });
});
