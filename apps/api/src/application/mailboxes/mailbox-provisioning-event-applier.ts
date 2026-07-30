import { Inject, Injectable } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { AUDIT_LOG_REPOSITORY, MAILBOX_REPOSITORY } from '../../infrastructure/persistence/tokens';

/** The subset of a Mailbox's provisioning-relevant fields the applier needs to guard against a mismatched event. */
export interface ProvisioningEventTarget {
  id: string;
  organizationId: string;
}

/**
 * Single, shared translation of "engine-reported provisioning event" into
 * "account state", used identically by `UpdateMailboxConfigurationUseCase`
 * and the legacy `MailboxProvisioningService` (never two separate
 * mappings). Always called strictly after the business transaction has
 * committed — this never opens or participates in a database transaction
 * itself.
 *
 * Idempotent by construction: `IntegrationService.advance()` only ever
 * returns *newly recorded* events (already-applied events are filtered
 * out via their `eventId` before this is ever invoked), so re-processing
 * an already-COMPLETED/FAILED command simply yields zero events and this
 * is never called again for it — no separate de-duplication needed here.
 */
@Injectable()
export class MailboxProvisioningEventApplier {
  constructor(
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  /**
   * @param mailbox The account this event is expected to belong to — used only to defend against a mismatched event (never trusted blindly from the caller's aggregateId).
   */
  async apply(
    organizationId: string,
    mailbox: ProvisioningEventTarget,
    event: IntegrationEvent,
    actorId: string,
  ): Promise<void> {
    if (mailbox.organizationId !== organizationId) {
      // Defense in depth — never happens in practice since both come from
      // the same caller, but a mismatch here would mean two tenants'
      // events could cross-contaminate accounts, so this is a hard stop.
      return;
    }

    switch (event.eventType) {
      case 'MAILBOX_PROVISION_ACCEPTED':
        await this.auditLogs.record({
          organizationId,
          actorId,
          action: 'mailbox.provision_accepted',
          entityType: 'Mailbox',
          entityId: mailbox.id,
          metadata: { commandId: event.commandId },
        });
        break;
      case 'MAILBOX_PROVISION_STARTED':
        await this.mailboxes.update(mailbox.id, { provisioningStatus: 'PROVISIONING' });
        await this.auditLogs.record({
          organizationId,
          actorId,
          action: 'mailbox.provision_started',
          entityType: 'Mailbox',
          entityId: mailbox.id,
          metadata: { commandId: event.commandId },
        });
        break;
      case 'MAILBOX_IMAP_VALIDATED':
        await this.mailboxes.update(mailbox.id, { connectionStatus: 'PARTIALLY_CONNECTED' });
        break;
      case 'MAILBOX_SMTP_VALIDATED':
        await this.mailboxes.update(mailbox.id, { connectionStatus: 'CONNECTED' });
        break;
      case 'MAILBOX_PROVISION_COMPLETED':
        await this.mailboxes.update(mailbox.id, {
          provisioningStatus: 'PROVISIONED',
          connectionStatus: 'CONNECTED',
        });
        await this.auditLogs.record({
          organizationId,
          actorId,
          action: 'mailbox.provision_completed',
          entityType: 'Mailbox',
          entityId: mailbox.id,
          metadata: { commandId: event.commandId },
        });
        break;
      case 'MAILBOX_PROVISION_FAILED': {
        const payload = event.payload as { message?: string } | undefined;
        await this.mailboxes.update(mailbox.id, {
          provisioningStatus: 'PROVISION_FAILED',
          connectionStatus: 'CONNECTION_ERROR',
        });
        await this.auditLogs.record({
          organizationId,
          actorId,
          action: 'mailbox.provision_failed',
          entityType: 'Mailbox',
          entityId: mailbox.id,
          // Sanitized message only — the raw event payload from the
          // simulated engine never carries credentials, but this is
          // still never the full payload, only the human-readable reason.
          metadata: { commandId: event.commandId, reason: payload?.message ?? null },
        });
        break;
      }
      default:
        // Unknown/unhandled event type — ignored in a controlled way
        // (never throws), matching "rechazar o ignorar de forma
        // controlada transiciones imposibles."
        break;
    }
  }
}
