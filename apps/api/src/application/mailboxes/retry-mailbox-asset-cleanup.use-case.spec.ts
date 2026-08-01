import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SignatureAssetStoragePort } from '../../domain/signature-asset-storage/signature-asset-storage.port';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { RetryMailboxAssetCleanupUseCase } from './retry-mailbox-asset-cleanup.use-case';

describe('RetryMailboxAssetCleanupUseCase', () => {
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findByIdIncludingDeleted' | 'update'>>;
  let storage: jest.Mocked<Pick<SignatureAssetStoragePort, 'deleteObjectsByPrefix'>>;
  let auditLogs: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let config: Pick<AppConfigService, 'r2SignaturePrefix'>;
  let useCase: RetryMailboxAssetCleanupUseCase;

  const orgId = 'org_1';

  const buildMailbox = (overrides: Partial<Mailbox> = {}): Mailbox =>
    ({
      id: 'mailbox_1',
      organizationId: orgId,
      email: 'ventas@example.com',
      assetCleanupStatus: 'FAILED',
      assetCleanupAttempts: 1,
      lastAssetCleanupError: 'previous error',
      ...overrides,
    }) as Mailbox;

  beforeEach(() => {
    mailboxes = {
      findByIdIncludingDeleted: jest.fn().mockResolvedValue(buildMailbox()),
      update: jest.fn().mockImplementation(async (_id, patch) => ({ ...buildMailbox(), ...patch })),
    };
    storage = { deleteObjectsByPrefix: jest.fn().mockResolvedValue({ deletedCount: 3 }) };
    auditLogs = { record: jest.fn() };
    config = { r2SignaturePrefix: 'firmas' };

    useCase = new RetryMailboxAssetCleanupUseCase(
      mailboxes as unknown as MailboxRepository,
      storage as unknown as SignatureAssetStoragePort,
      auditLogs as unknown as AuditLogRepository,
      config as unknown as AppConfigService,
    );
  });

  it('404s for a mailbox that does not exist or belongs to another organization', async () => {
    mailboxes.findByIdIncludingDeleted.mockResolvedValue(null);
    await expect(useCase.execute(orgId, 'ghost', 'admin_1')).rejects.toBeInstanceOf(NotFoundException);

    mailboxes.findByIdIncludingDeleted.mockResolvedValue(buildMailbox({ organizationId: 'other_org' }));
    await expect(useCase.execute(orgId, 'mailbox_1', 'admin_1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is idempotent — an already-COMPLETED cleanup returns success without calling storage again', async () => {
    mailboxes.findByIdIncludingDeleted.mockResolvedValue(buildMailbox({ assetCleanupStatus: 'COMPLETED' }));
    const result = await useCase.execute(orgId, 'mailbox_1', 'admin_1');
    expect(result).toEqual({ assetCleanupStatus: 'COMPLETED' });
    expect(storage.deleteObjectsByPrefix).not.toHaveBeenCalled();
  });

  it('rejects retrying a mailbox that has no pending/failed cleanup (e.g. NOT_NEEDED or PENDING)', async () => {
    mailboxes.findByIdIncludingDeleted.mockResolvedValue(buildMailbox({ assetCleanupStatus: 'NOT_NEEDED' }));
    await expect(useCase.execute(orgId, 'mailbox_1', 'admin_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('retries the prefix purge, marks COMPLETED, and audits with retried:true', async () => {
    const result = await useCase.execute(orgId, 'mailbox_1', 'admin_1');

    expect(storage.deleteObjectsByPrefix).toHaveBeenCalledWith('firmas/ventas@example.com/');
    expect(result).toEqual({ assetCleanupStatus: 'COMPLETED', deletedCount: 3 });
    expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', { assetCleanupStatus: 'COMPLETED' });
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mailbox.asset_cleanup_completed', metadata: { deletedCount: 3, retried: true } }),
    );
  });

  it('a second consecutive failure increments assetCleanupAttempts and persists the new error', async () => {
    storage.deleteObjectsByPrefix.mockRejectedValue(new Error('still unreachable'));

    const result = await useCase.execute(orgId, 'mailbox_1', 'admin_1');

    expect(result).toEqual({ assetCleanupStatus: 'FAILED' });
    expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', {
      assetCleanupStatus: 'FAILED',
      assetCleanupAttempts: 2,
      lastAssetCleanupError: 'still unreachable',
    });
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mailbox.asset_cleanup_failed', metadata: { error: 'still unreachable', retried: true } }),
    );
  });
});
