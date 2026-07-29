import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import {
  AUDIT_LOG_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { isUniqueConstraintViolation } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { IntegrationService } from '../integration/integration.service';

export interface RemoveContactFromSequenceInput {
  organizationId: string;
  sequenceId: string;
  sequenceContactId: string;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface RemoveContactFromSequenceResult {
  sequenceContactId: string;
  sequenceId: string;
  status: string;
  cancelledJobs: number;
  commandId: string;
  commandStatus: string;
  correlationId: string;
}

/**
 * Fase 2, Caso D — replaces SequenceContactsService.removeContact(): future
 * job cancellation, the contact's REMOVED transition, the audit entry and
 * the command claim now commit together in one transaction (previously
 * three independent, non-transactional calls with no rollback safety and
 * no audit trail at all). Idempotency-Key is a required client-generated
 * header (never server-generated). Never touches executed jobs/sent
 * emails, never deletes the global Contact, never affects any other
 * sequence this contact may be enrolled in.
 *
 * Dispatch to the (simulated) engine happens strictly after commit — same
 * post-commit, best-effort pattern as Casos A/B/C. Unlike publish/mailbox
 * provisioning, this command has no modeled FAILED/TIMEOUT outcome (a
 * single, always-successful `_REMOVED` event — see
 * SimulatedMailEngineAdapter.planContactRemoveEvents), so the business
 * state (job cancellation + REMOVED transition) is never gated on the
 * engine's confirmation — there is nothing for the engine to reject.
 */
@Injectable()
export class RemoveContactFromSequenceUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly idempotency: IdempotentOperationService,
    private readonly integration: IntegrationService,
  ) {}

  async execute(
    input: RemoveContactFromSequenceInput,
  ): Promise<{ result: RemoveContactFromSequenceResult; httpStatus: number }> {
    const contact = await this.sequenceContacts.findById(input.sequenceContactId);
    if (!contact || contact.organizationId !== input.organizationId || contact.sequenceId !== input.sequenceId) {
      throw new NotFoundException('Sequence contact not found.');
    }

    const payloadHash = hashLogicalPayload({
      sequenceContactId: contact.id,
      sequenceId: input.sequenceId,
      reason: input.reason,
    });

    const existing = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.SEQUENCE_CONTACT_REMOVE,
      input.idempotencyKey,
      payloadHash,
    );
    if (existing) {
      return {
        result: existing.resultSnapshot as unknown as RemoveContactFromSequenceResult,
        httpStatus: existing.httpStatusCode ?? 201,
      };
    }

    try {
      const { result, command } = await this.tx.run(async (ctx) => {
        const claimedCount = await this.sequenceContacts.conditionalRemove(contact.id, input.reason, ctx);
        if (claimedCount !== 1) {
          throw new ConflictException('Este contacto ya fue retirado de la secuencia.');
        }

        const cancelledJobs = await this.scheduledEmails.cancelFutureForSequenceContact(contact.id, input.reason, ctx);

        const correlationId = input.correlationId ?? `corr_${contact.id}`;
        const commandId = `cmd_${randomUUID()}`;

        await this.auditLogs.record(
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: 'sequence_contact.remove',
            entityType: 'SequenceContact',
            entityId: contact.id,
            metadata: { correlationId, idempotencyKey: input.idempotencyKey, sequenceId: input.sequenceId, reason: input.reason, cancelledJobs },
          },
          ctx,
        );

        const result: RemoveContactFromSequenceResult = {
          sequenceContactId: contact.id,
          sequenceId: input.sequenceId,
          status: 'REMOVED',
          cancelledJobs,
          commandId,
          commandStatus: 'REQUESTED',
          correlationId,
        };

        const command = await this.idempotency.claim(
          ctx,
          {
            organizationId: input.organizationId,
            scope: IDEMPOTENCY_SCOPE.SEQUENCE_CONTACT_REMOVE,
            rawIdempotencyKey: input.idempotencyKey,
            payloadHash,
            commandType: 'SEQUENCE_CONTACT_REMOVE_REQUESTED',
            aggregateType: 'SEQUENCE_CONTACT',
            aggregateId: contact.id,
            correlationId,
            requestedBy: input.actorId,
            commandPayload: { sequenceId: input.sequenceId, sequenceContactId: contact.id, contactId: contact.contactId, reason: input.reason },
            commandId,
          },
          result as unknown as Record<string, unknown>,
          201,
        );

        return { result, command };
      });

      try {
        const dispatched = await this.integration.dispatchExistingCommand(command, input.actorId);
        result.commandStatus = dispatched.status;
        await this.integration.advance(input.organizationId, command.commandId, 'ALL', input.actorId);
        await this.idempotency.refreshResultSnapshot(command.id, result as unknown as Record<string, unknown>);
      } catch (dispatchError) {
        console.error(
          JSON.stringify({
            event: 'remove_contact_from_sequence.dispatch_failed',
            correlationId: result.correlationId,
            commandId: result.commandId,
            organizationId: input.organizationId,
            message: dispatchError instanceof Error ? dispatchError.message : 'unknown error',
          }),
        );
      }

      return { result, httpStatus: 201 };
    } catch (error) {
      if (error instanceof ConflictException || isUniqueConstraintViolation(error)) {
        const raced = await this.idempotency.checkExisting(
          input.organizationId,
          IDEMPOTENCY_SCOPE.SEQUENCE_CONTACT_REMOVE,
          input.idempotencyKey,
          payloadHash,
        );
        if (raced) {
          return {
            result: raced.resultSnapshot as unknown as RemoveContactFromSequenceResult,
            httpStatus: raced.httpStatusCode ?? 201,
          };
        }
      }
      throw error;
    }
  }
}
