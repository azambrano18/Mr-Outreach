import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MAILBOX_MOTOR_PORT, MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';

export interface UnlinkMailboxInput {
  organizationId: string;
  mailboxId: string;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface UnlinkMailboxResult {
  mailboxId: string;
  linkStatus: 'UNLINK_REQUESTED' | 'REVOKED';
  revocationId: string | null;
  cancelledJobsCount: number;
  businessOperationConfirmed: true;
}

/**
 * Fase 2.1, §14 — "Mr Outreach deja de estar autorizado para utilizar la
 * cuenta". Never deletes the account, its history, sent emails, sequences,
 * commands, events or audit. Only SERVER_TOKEN mailboxes go through this —
 * there is no motor link to revoke for a LEGACY_LOCAL account.
 */
@Injectable()
export class UnlinkMailboxUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(MAILBOX_MOTOR_PORT) private readonly motor: MailboxMotorPort,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    private readonly idempotency: IdempotentOperationService,
    private readonly clientVisibility: ClientMailboxVisibilityService,
  ) {}

  async execute(input: UnlinkMailboxInput): Promise<{ result: UnlinkMailboxResult; httpStatus: number }> {
    if (!input.reason || !input.reason.trim()) {
      throw new BadRequestException('El motivo de desvinculación es obligatorio.');
    }
    const payloadHash = hashLogicalPayload({ mailboxId: input.mailboxId, reason: input.reason });

    const existing = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.MAILBOX_UNLINK,
      input.idempotencyKey,
      payloadHash,
    );
    if (existing) {
      return {
        result: existing.resultSnapshot as unknown as UnlinkMailboxResult,
        httpStatus: existing.httpStatusCode ?? 200,
      };
    }

    const { result, mailbox, commandRowId, alreadyTerminal } = await this.tx.run(async (ctx) => {
      const mailbox = await this.mailboxes.findById(input.mailboxId, ctx);
      if (!mailbox || mailbox.organizationId !== input.organizationId) {
        throw new NotFoundException('Cuenta de correo no encontrada.');
      }
      if (mailbox.linkSource !== 'SERVER_TOKEN') {
        throw new ConflictException('Esta cuenta no está vinculada por token; no admite desvinculación.');
      }

      if (mailbox.linkStatus === 'REVOKED') {
        // Idempotent no-op: a second, differently-keyed unlink request
        // against an already-revoked account is a success, never an error.
        const result: UnlinkMailboxResult = {
          mailboxId: mailbox.id,
          linkStatus: 'REVOKED',
          revocationId: mailbox.revocationId,
          cancelledJobsCount: 0,
          businessOperationConfirmed: true,
        };
        return { result, mailbox, commandRowId: null, alreadyTerminal: true };
      }

      const cancelledJobsCount = await this.scheduledEmails.cancelFutureForMailbox(mailbox.id, input.reason, ctx);

      const updated = await this.mailboxes.update(
        mailbox.id,
        {
          linkStatus: 'UNLINK_REQUESTED',
          unlinkRequestedAt: new Date(),
          unlinkRequestedBy: input.actorId,
          unlinkReason: input.reason,
        },
        ctx,
      );

      const correlationId = input.correlationId ?? `corr_${mailbox.id}`;
      await this.auditLogs.record(
        {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: 'mailbox.unlink_requested',
          entityType: 'Mailbox',
          entityId: mailbox.id,
          metadata: {
            correlationId,
            idempotencyKey: input.idempotencyKey,
            reason: input.reason,
            cancelledJobsCount,
            serverMailboxId: mailbox.serverMailboxId,
          },
        },
        ctx,
      );

      const result: UnlinkMailboxResult = {
        mailboxId: mailbox.id,
        linkStatus: 'UNLINK_REQUESTED',
        revocationId: null,
        cancelledJobsCount,
        businessOperationConfirmed: true,
      };

      const command = await this.idempotency.claim(
        ctx,
        {
          organizationId: input.organizationId,
          scope: IDEMPOTENCY_SCOPE.MAILBOX_UNLINK,
          rawIdempotencyKey: input.idempotencyKey,
          payloadHash,
          commandType: 'MAILBOX_UNLINK_REQUESTED',
          aggregateType: 'MAILBOX',
          aggregateId: mailbox.id,
          correlationId,
          requestedBy: input.actorId,
          commandPayload: { serverMailboxId: mailbox.serverMailboxId, reason: input.reason },
          commandId: `cmd_${randomUUID()}`,
        },
        result as unknown as Record<string, unknown>,
        200,
      );
      // Deliberately NOT marked completed here — there is real pending
      // async work (motor confirmation) attempted strictly after commit.

      return { result, mailbox: updated, commandRowId: command.id, alreadyTerminal: false };
    });

    if (alreadyTerminal) {
      return { result, httpStatus: 200 };
    }

    return this.confirmWithMotor(input, mailbox.id, mailbox.serverMailboxId!, mailbox.clientId, result, commandRowId!);
  }

  /**
   * Fase 2.1, §14 — retries the post-commit motor confirmation for a
   * mailbox stuck in UNLINK_REQUESTED (previous attempt's motor call
   * failed). Never re-opens the local transaction, never cancels jobs
   * again, never creates a second command.
   */
  async retryConfirmation(organizationId: string, mailboxId: string, actorId: string): Promise<UnlinkMailboxResult> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Cuenta de correo no encontrada.');
    }
    if (mailbox.linkStatus === 'REVOKED') {
      return {
        mailboxId: mailbox.id,
        linkStatus: 'REVOKED',
        revocationId: mailbox.revocationId,
        cancelledJobsCount: 0,
        businessOperationConfirmed: true,
      };
    }
    if (mailbox.linkStatus !== 'UNLINK_REQUESTED') {
      throw new ConflictException('Esta cuenta no tiene una desvinculación pendiente de confirmar.');
    }

    const pendingResult: UnlinkMailboxResult = {
      mailboxId: mailbox.id,
      linkStatus: 'UNLINK_REQUESTED',
      revocationId: null,
      cancelledJobsCount: 0,
      businessOperationConfirmed: true,
    };
    const { result } = await this.confirmWithMotor(
      { organizationId, mailboxId, reason: mailbox.unlinkReason ?? '', actorId, idempotencyKey: `retry_${randomUUID()}` },
      mailbox.id,
      mailbox.serverMailboxId!,
      mailbox.clientId,
      pendingResult,
      null,
    );
    return result;
  }

  private async confirmWithMotor(
    input: UnlinkMailboxInput,
    mailboxId: string,
    serverMailboxId: string,
    clientId: string | null,
    result: UnlinkMailboxResult,
    commandRowId: string | null,
  ): Promise<{ result: UnlinkMailboxResult; httpStatus: number }> {
    try {
      const revocation = await this.motor.unlinkMailbox({
        serverMailboxId,
        idempotencyKey: input.idempotencyKey,
        requestingOrganizationId: input.organizationId,
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId ?? `corr_${mailboxId}`,
      });

      await this.mailboxes.update(mailboxId, {
        linkStatus: 'REVOKED',
        revokedAt: revocation.revokedAt,
        revocationId: revocation.revocationId,
        serverStatusCheckedAt: new Date(),
      });
      await this.auditLogs.record({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: 'mailbox.unlink_confirmed',
        entityType: 'Mailbox',
        entityId: mailboxId,
        metadata: { revocationId: revocation.revocationId, serverMailboxId },
      });
      if (commandRowId) {
        await this.idempotency.markCompleted(commandRowId);
      }

      // §10 — a revoked account no longer counts as "a mailbox for this
      // client"; any executive whose visibility was purely derived from
      // it (never MANUAL) loses that visibility.
      if (clientId) {
        const assignees = await this.assignments.findByMailbox(mailboxId);
        for (const assignee of assignees) {
          await this.clientVisibility.revokeIfNoRemainingMailbox(input.organizationId, clientId, assignee.userId);
        }
      }

      return {
        result: { ...result, linkStatus: 'REVOKED', revocationId: revocation.revocationId },
        httpStatus: 200,
      };
    } catch (motorError) {
      const message = motorError instanceof Error ? motorError.message : 'unknown error';
      console.error(
        JSON.stringify({
          event: 'unlink_mailbox.motor_confirmation_failed',
          mailboxId,
          organizationId: input.organizationId,
          message,
        }),
      );
      await this.auditLogs.record({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: 'mailbox.unlink_failed',
        entityType: 'Mailbox',
        entityId: mailboxId,
        metadata: { serverMailboxId, reason: 'motor_confirmation_failed', error: message },
      });
      // result.linkStatus stays UNLINK_REQUESTED — never claim revoked when
      // the motor never confirmed it. The account remains blocked for new
      // activity (linkStatus !== ACTIVE), never reactivated.
      return { result, httpStatus: 200 };
    }
  }
}
