import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssetCleanupStatus } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { buildSignatureFolderPrefix, normalizeMailboxEmailForStorageKey } from '../../domain/signature-asset/normalize-mailbox-email-for-storage';
import { SignatureAssetStoragePort } from '../../domain/signature-asset-storage/signature-asset-storage.port';
import { AUDIT_LOG_REPOSITORY, MAILBOX_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { SIGNATURE_ASSET_STORAGE_PORT } from '../../infrastructure/signature-asset-storage/tokens';

export interface RetryMailboxAssetCleanupResult {
  assetCleanupStatus: MailboxAssetCleanupStatus;
  deletedCount?: number;
}

/**
 * §22 — a manual, explicit retry for a mailbox stuck in `assetCleanupStatus:
 * FAILED` after DeleteMailboxUseCase's post-commit R2 purge attempt failed.
 * Deliberately looks the mailbox up via `findByIdIncludingDeleted` — the
 * mailbox this operates on is, by definition, already soft-deleted.
 * Idempotent: retrying an already-COMPLETED cleanup is a no-op success,
 * never an error, and never re-triggers a second purge.
 */
@Injectable()
export class RetryMailboxAssetCleanupUseCase {
  constructor(
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(SIGNATURE_ASSET_STORAGE_PORT) private readonly storage: SignatureAssetStoragePort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly config: AppConfigService,
  ) {}

  async execute(organizationId: string, mailboxId: string, actorId: string): Promise<RetryMailboxAssetCleanupResult> {
    const mailbox = await this.mailboxes.findByIdIncludingDeleted(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Cuenta de correo no encontrada.');
    }
    if (mailbox.assetCleanupStatus === 'COMPLETED') {
      return { assetCleanupStatus: 'COMPLETED' };
    }
    if (mailbox.assetCleanupStatus !== 'FAILED') {
      throw new ConflictException('Esta cuenta no tiene una limpieza de assets pendiente de reintentar.');
    }

    try {
      const normalizedEmail = normalizeMailboxEmailForStorageKey(mailbox.email);
      const prefix = buildSignatureFolderPrefix(this.config.r2SignaturePrefix, normalizedEmail);
      const result = await this.storage.deleteObjectsByPrefix(prefix);

      await this.mailboxes.update(mailbox.id, { assetCleanupStatus: 'COMPLETED' });
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'mailbox.asset_cleanup_completed',
        entityType: 'Mailbox',
        entityId: mailbox.id,
        metadata: { deletedCount: result.deletedCount, retried: true },
      });
      return { assetCleanupStatus: 'COMPLETED', deletedCount: result.deletedCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await this.mailboxes.update(mailbox.id, {
        assetCleanupStatus: 'FAILED',
        assetCleanupAttempts: mailbox.assetCleanupAttempts + 1,
        lastAssetCleanupError: message,
      });
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'mailbox.asset_cleanup_failed',
        entityType: 'Mailbox',
        entityId: mailbox.id,
        metadata: { error: message, retried: true },
      });
      return { assetCleanupStatus: 'FAILED' };
    }
  }
}
