import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import {
  AUDIT_LOG_REPOSITORY,
  COMPANY_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { isUniqueConstraintViolation } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { IntegrationService } from '../integration/integration.service';

export interface RemoveCompanyFromSequenceInput {
  organizationId: string;
  sequenceId: string;
  companyId: string;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface RemoveCompanyFromSequenceResult {
  companyId: string;
  sequenceId: string;
  affectedContacts: number;
  cancelledJobs: number;
  commandId: string;
  commandStatus: string;
  correlationId: string;
}

/**
 * Fase 2, Caso E — replaces SequenceContactsService.removeCompany(): future
 * job cancellation across every one of the company's contacts within this
 * sequence, their REMOVED transition, the audit entry and the command
 * claim now commit together in one transaction, via bulk `updateMany`
 * statements (never one query per contact/job — see
 * SequenceContactRepository.bulkRemoveByCompany /
 * ScheduledEmailRepository.cancelFutureForSequenceCompany). Scoped to ONE
 * sequence only — never a global exclusion, never touches other
 * sequences this company's contacts may be enrolled in, never deletes the
 * global Company/Contact rows.
 *
 * Naturally concurrency-safe without a separate claim step: both bulk
 * updates are `WHERE status != 'REMOVED'`-guarded, so two overlapping
 * calls simply serialize at the row level and the second one finds
 * nothing left to change (0 affected, not an error) — no double
 * cancellation, no double audit entry (each call still records its own
 * audit/command, but only for the rows it actually changed).
 */
@Injectable()
export class RemoveCompanyFromSequenceUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly idempotency: IdempotentOperationService,
    private readonly integration: IntegrationService,
  ) {}

  async execute(
    input: RemoveCompanyFromSequenceInput,
  ): Promise<{ result: RemoveCompanyFromSequenceResult; httpStatus: number }> {
    const company = await this.companies.findById(input.companyId);
    if (!company || company.organizationId !== input.organizationId) {
      throw new NotFoundException('Company not found.');
    }

    const payloadHash = hashLogicalPayload({
      companyId: input.companyId,
      sequenceId: input.sequenceId,
      reason: input.reason,
    });

    const existing = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.SEQUENCE_COMPANY_REMOVE,
      input.idempotencyKey,
      payloadHash,
    );
    if (existing) {
      return {
        result: existing.resultSnapshot as unknown as RemoveCompanyFromSequenceResult,
        httpStatus: existing.httpStatusCode ?? 201,
      };
    }

    try {
      const { result, command } = await this.tx.run(async (ctx) => {
        const affectedContacts = await this.sequenceContacts.bulkRemoveByCompany(
          input.organizationId,
          input.sequenceId,
          input.companyId,
          input.reason,
          ctx,
        );
        const cancelledJobs = await this.scheduledEmails.cancelFutureForSequenceCompany(
          input.sequenceId,
          input.companyId,
          input.reason,
          ctx,
        );

        const correlationId = input.correlationId ?? `corr_${input.companyId}`;
        const commandId = `cmd_${randomUUID()}`;

        await this.auditLogs.record(
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: 'sequence_company.remove',
            entityType: 'Company',
            entityId: input.companyId,
            metadata: {
              correlationId,
              idempotencyKey: input.idempotencyKey,
              sequenceId: input.sequenceId,
              reason: input.reason,
              affectedContacts,
              cancelledJobs,
            },
          },
          ctx,
        );

        const result: RemoveCompanyFromSequenceResult = {
          companyId: input.companyId,
          sequenceId: input.sequenceId,
          affectedContacts,
          cancelledJobs,
          commandId,
          commandStatus: 'REQUESTED',
          correlationId,
        };

        const command = await this.idempotency.claim(
          ctx,
          {
            organizationId: input.organizationId,
            scope: IDEMPOTENCY_SCOPE.SEQUENCE_COMPANY_REMOVE,
            rawIdempotencyKey: input.idempotencyKey,
            payloadHash,
            commandType: 'SEQUENCE_COMPANY_REMOVE_REQUESTED',
            aggregateType: 'SEQUENCE_COMPANY',
            aggregateId: input.companyId,
            correlationId,
            requestedBy: input.actorId,
            commandPayload: { sequenceId: input.sequenceId, companyId: input.companyId, reason: input.reason },
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
            event: 'remove_company_from_sequence.dispatch_failed',
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
          IDEMPOTENCY_SCOPE.SEQUENCE_COMPANY_REMOVE,
          input.idempotencyKey,
          payloadHash,
        );
        if (raced) {
          return {
            result: raced.resultSnapshot as unknown as RemoveCompanyFromSequenceResult,
            httpStatus: raced.httpStatusCode ?? 201,
          };
        }
      }
      throw error;
    }
  }
}
