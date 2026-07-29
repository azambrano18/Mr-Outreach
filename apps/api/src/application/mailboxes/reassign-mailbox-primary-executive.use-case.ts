import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { isUniqueConstraintViolation } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';

export interface ReassignMailboxPrimaryExecutiveInput {
  organizationId: string;
  mailboxId: string;
  newPrimaryExecutiveId: string;
  reason?: string | null;
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface ReassignMailboxPrimaryExecutiveResult {
  mailboxId: string;
  previousPrimaryExecutiveId: string | null;
  newPrimaryExecutiveId: string;
  businessOperationConfirmed: true;
}

/**
 * Fase 2.1, §13 — reassigns who operates a mailbox without touching the
 * account itself: no new token, no client/domain/email change, no call to
 * the motor. Works identically for SERVER_TOKEN and LEGACY_LOCAL mailboxes
 * — reassignment is purely a local concept.
 */
@Injectable()
export class ReassignMailboxPrimaryExecutiveUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly idempotency: IdempotentOperationService,
    private readonly executiveValidator: MailboxExecutiveAssignmentValidator,
    private readonly clientVisibility: ClientMailboxVisibilityService,
  ) {}

  async execute(
    input: ReassignMailboxPrimaryExecutiveInput,
  ): Promise<{ result: ReassignMailboxPrimaryExecutiveResult; httpStatus: number }> {
    const payloadHash = hashLogicalPayload({
      mailboxId: input.mailboxId,
      newPrimaryExecutiveId: input.newPrimaryExecutiveId,
      reason: input.reason ?? null,
    });

    const existing = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.MAILBOX_REASSIGN_PRIMARY,
      input.idempotencyKey,
      payloadHash,
    );
    if (existing) {
      return {
        result: existing.resultSnapshot as unknown as ReassignMailboxPrimaryExecutiveResult,
        httpStatus: existing.httpStatusCode ?? 200,
      };
    }

    try {
      const { result } = await this.tx.run(async (ctx) => {
        const mailbox = await this.mailboxes.findById(input.mailboxId, ctx);
        if (!mailbox || mailbox.organizationId !== input.organizationId) {
          throw new NotFoundException('Cuenta de correo no encontrada.');
        }
        if (mailbox.linkStatus === 'REVOKED') {
          throw new ConflictException('Esta cuenta fue revocada; no admite reasignación de ejecutivo.');
        }
        if (!mailbox.clientId) {
          throw new ConflictException('Esta cuenta no está vinculada a un cliente.');
        }

        // Authoritative validation, same TransactionContext as the write below.
        await this.executiveValidator.validate(
          {
            organizationId: input.organizationId,
            clientId: mailbox.clientId,
            primaryExecutiveId: input.newPrimaryExecutiveId,
            secondaryExecutiveIds: [],
          },
          ctx,
        );

        const currentAssignments = await this.assignments.findByMailbox(mailbox.id, ctx);
        const previousPrimary = currentAssignments.find((a) => a.role === 'PRIMARY') ?? null;

        if (previousPrimary && previousPrimary.userId !== input.newPrimaryExecutiveId) {
          await this.assignments.remove(mailbox.id, previousPrimary.userId, ctx);
        }
        await this.assignments.upsert(
          {
            organizationId: input.organizationId,
            mailboxId: mailbox.id,
            userId: input.newPrimaryExecutiveId,
            role: 'PRIMARY',
            assignedBy: input.actorId,
          },
          ctx,
        );

        // §10 — the new primary automatically gets client visibility; the
        // outgoing primary loses their derived visibility if this was
        // their last mailbox for the client (a MANUAL grant is untouched).
        await this.clientVisibility.grantForExecutives(
          input.organizationId,
          mailbox.clientId,
          [input.newPrimaryExecutiveId],
          input.actorId,
          ctx,
        );
        if (previousPrimary && previousPrimary.userId !== input.newPrimaryExecutiveId) {
          await this.clientVisibility.revokeIfNoRemainingMailbox(
            input.organizationId,
            mailbox.clientId,
            previousPrimary.userId,
            ctx,
          );
        }

        const correlationId = input.correlationId ?? `corr_${mailbox.id}`;
        await this.auditLogs.record(
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: 'mailbox.reassign_primary_executive',
            entityType: 'Mailbox',
            entityId: mailbox.id,
            metadata: {
              correlationId,
              idempotencyKey: input.idempotencyKey,
              previousPrimaryExecutiveId: previousPrimary?.userId ?? null,
              newPrimaryExecutiveId: input.newPrimaryExecutiveId,
              reason: input.reason ?? null,
            },
          },
          ctx,
        );

        const result: ReassignMailboxPrimaryExecutiveResult = {
          mailboxId: mailbox.id,
          previousPrimaryExecutiveId: previousPrimary?.userId ?? null,
          newPrimaryExecutiveId: input.newPrimaryExecutiveId,
          businessOperationConfirmed: true,
        };

        const command = await this.idempotency.claim(
          ctx,
          {
            organizationId: input.organizationId,
            scope: IDEMPOTENCY_SCOPE.MAILBOX_REASSIGN_PRIMARY,
            rawIdempotencyKey: input.idempotencyKey,
            payloadHash,
            commandType: 'MAILBOX_REASSIGN_PRIMARY_REQUESTED',
            aggregateType: 'MAILBOX',
            aggregateId: mailbox.id,
            correlationId,
            requestedBy: input.actorId,
            commandPayload: {
              previousPrimaryExecutiveId: previousPrimary?.userId ?? null,
              newPrimaryExecutiveId: input.newPrimaryExecutiveId,
            },
            commandId: `cmd_${randomUUID()}`,
          },
          result as unknown as Record<string, unknown>,
          200,
        );
        await this.idempotency.markCompleted(command.id, ctx);

        return { result };
      });

      return { result, httpStatus: 200 };
    } catch (error) {
      if (error instanceof ConflictException || isUniqueConstraintViolation(error)) {
        const raced = await this.idempotency.checkExisting(
          input.organizationId,
          IDEMPOTENCY_SCOPE.MAILBOX_REASSIGN_PRIMARY,
          input.idempotencyKey,
          payloadHash,
        );
        if (raced) {
          return {
            result: raced.resultSnapshot as unknown as ReassignMailboxPrimaryExecutiveResult,
            httpStatus: raced.httpStatusCode ?? 200,
          };
        }
      }
      throw error;
    }
  }
}
