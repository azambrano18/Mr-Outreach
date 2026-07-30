import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import {
  MailboxLinkTokenInfo,
  MailboxMotorClientInfo,
  MailboxMotorDomainInfo,
  MailboxMotorMailboxInfo,
} from '../../domain/mailbox-motor/mailbox-motor.types';
import { MAILBOX_MOTOR_PORT, MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { TransactionManager } from '../../domain/persistence/transaction';
import { isUniqueConstraintViolation } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import {
  AUDIT_LOG_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { ClientsService } from '../clients/clients.service';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';

export interface IntrospectLinkTokenResult {
  valid: boolean;
  status: MailboxLinkTokenInfo['status'];
  expiresAt: Date;
  mailbox: MailboxMotorMailboxInfo;
  domain: MailboxMotorDomainInfo;
  client: MailboxMotorClientInfo;
}

export interface LinkMailboxInput {
  organizationId: string;
  /** Kept in memory only for the duration of this call — see MailboxMotorPort's doc comment. Never logged, never persisted. */
  token: string;
  primaryExecutiveId: string;
  secondaryExecutiveIds?: string[];
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface LinkMailboxResult {
  mailboxId: string;
  clientId: string;
  domainId: string;
  serverMailboxId: string;
  primaryExecutiveId: string;
  secondaryExecutiveIds: string[];
  commandId: string;
  correlationId: string;
  businessOperationConfirmed: true;
  commandPersisted: true;
  linkStatus: 'ACTIVE';
}

/** Never persisted, never logged — only for the local idempotency-hash comparison, itself already one-way SHA-256'd by hashLogicalPayload. */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Last 4 chars only — safe for audit metadata/UI, per the phase's fingerprint requirement (`tok_****a82f`). */
function tokenFingerprint(token: string): string {
  return `tok_****${token.slice(-4)}`;
}

/**
 * Fase 2.1 — replaces manual IMAP/SMTP configuration as the standard way to
 * add a mailbox: the motor is the sole source of truth for credentials,
 * client and domain. This use case only ever consumes what the motor
 * returns from a redemption — it never accepts client/domain/email/status
 * as trusted input from the caller.
 */
@Injectable()
export class LinkMailboxUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(MAILBOX_MOTOR_PORT) private readonly motor: MailboxMotorPort,
    private readonly clients: ClientsService,
    private readonly idempotency: IdempotentOperationService,
    private readonly executiveValidator: MailboxExecutiveAssignmentValidator,
    private readonly clientVisibility: ClientMailboxVisibilityService,
  ) {}

  /** Read-only — never redeems, never creates anything. Used by "Paso 1" of the admin UI. */
  async introspect(organizationId: string, actorId: string, token: string): Promise<IntrospectLinkTokenResult> {
    try {
      const info = await this.motor.introspectLinkToken(token);
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'mailbox.token_introspected',
        entityType: 'Mailbox',
        entityId: info.mailbox.serverMailboxId,
        metadata: { tokenFingerprint: tokenFingerprint(token), status: info.status, valid: info.valid },
      });
      return {
        valid: info.valid,
        status: info.status,
        expiresAt: info.expiresAt,
        mailbox: info.mailbox,
        domain: info.domain,
        client: info.client,
      };
    } catch (error) {
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'mailbox.token_introspection_failed',
        entityType: 'Mailbox',
        entityId: 'unknown',
        metadata: {
          tokenFingerprint: tokenFingerprint(token),
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
      throw error;
    }
  }

  async execute(input: LinkMailboxInput): Promise<{ result: LinkMailboxResult; httpStatus: number }> {
    const plan = this.executiveValidator.plan(input.primaryExecutiveId, input.secondaryExecutiveIds);
    const payloadHash = hashLogicalPayload({
      tokenHash: tokenHash(input.token),
      primaryExecutiveId: plan.primaryExecutiveId,
      secondaryExecutiveIds: [...plan.secondaryExecutiveIds].sort(),
    });

    const existing = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.MAILBOX_LINK,
      input.idempotencyKey,
      payloadHash,
    );
    if (existing) {
      return {
        result: existing.resultSnapshot as unknown as LinkMailboxResult,
        httpStatus: existing.httpStatusCode ?? 201,
      };
    }

    // Redeem BEFORE opening the local transaction — same principle as "el
    // CRM se consulta antes de abrir la transacción": an external system
    // that is the source of truth for the data we're about to persist is
    // never called from inside a Postgres transaction. Idempotent at the
    // motor's own level: a retry after a local-commit failure below safely
    // replays the SAME redemptionId (see MailboxMotorPort's doc comment).
    const redemption = await this.motor.redeemLinkToken({
      token: input.token,
      idempotencyKey: input.idempotencyKey,
      requestingOrganizationId: input.organizationId,
      actorId: input.actorId,
    });

    try {
      const { result } = await this.tx.run(async (ctx) => {
        const alreadyLinked = await this.mailboxes.findByServerMailboxId(redemption.mailbox.serverMailboxId, ctx);
        if (alreadyLinked) {
          throw new ConflictException('Esta cuenta ya fue vinculada por otra operación.');
        }

        const managedClient = await this.clients.upsertFromServerPayload(
          input.organizationId,
          redemption.client,
          input.actorId,
          {},
          ctx,
        );

        let domain = await this.domains.findByName(input.organizationId, redemption.domain.name, ctx);
        if (domain && domain.clientId !== managedClient.id) {
          throw new ConflictException('Este dominio ya pertenece a otro cliente en Mr Outreach.');
        }
        if (!domain) {
          domain = await this.domains.create(
            {
              organizationId: input.organizationId,
              clientId: managedClient.id,
              domainName: redemption.domain.name,
              createdBy: input.actorId,
            },
            ctx,
          );
        }

        // Authoritative validation — same TransactionContext as the writes
        // below, closing the race window between any preliminary frontend
        // check and this commit (executive deactivated/unassigned meanwhile).
        await this.executiveValidator.validate(
          {
            organizationId: input.organizationId,
            clientId: managedClient.id,
            primaryExecutiveId: plan.primaryExecutiveId,
            secondaryExecutiveIds: plan.secondaryExecutiveIds,
          },
          ctx,
        );

        const commandId = `cmd_${randomUUID()}`;
        const correlationId = input.correlationId ?? `corr_${redemption.mailbox.serverMailboxId}`;

        const mailbox = await this.mailboxes.createLinked(
          {
            organizationId: input.organizationId,
            clientId: managedClient.id,
            domainId: domain.id,
            name: redemption.mailbox.displayName,
            email: redemption.mailbox.email,
            fromName: redemption.mailbox.displayName,
            serverMailboxId: redemption.mailbox.serverMailboxId,
            serverDomainId: redemption.domain.serverDomainId,
            serverClientId: redemption.client.serverClientId,
            serverRedemptionId: redemption.redemptionId,
            tokenFingerprint: tokenFingerprint(input.token),
            emailSnapshot: redemption.mailbox.email,
            domainSnapshot: redemption.domain.name,
            clientNameSnapshot: redemption.client.name,
            serverStatusSnapshot: redemption.mailbox.status,
            serverCanSendSnapshot: redemption.mailbox.canSend,
            serverStatusCheckedAt: new Date(),
            linkedAt: new Date(),
            linkedBy: input.actorId,
            lastLinkCommandId: commandId,
          },
          ctx,
        );

        await this.assignments.upsert(
          {
            organizationId: input.organizationId,
            mailboxId: mailbox.id,
            userId: plan.primaryExecutiveId!,
            role: 'PRIMARY',
            assignedBy: input.actorId,
          },
          ctx,
        );
        for (const userId of plan.secondaryExecutiveIds) {
          await this.assignments.upsert(
            { organizationId: input.organizationId, mailboxId: mailbox.id, userId, role: 'SECONDARY', assignedBy: input.actorId },
            ctx,
          );
        }

        // §10 — every assigned executive automatically gets visibility on
        // the linked client, with no prior manual client assignment.
        await this.clientVisibility.grantForExecutives(
          input.organizationId,
          managedClient.id,
          [plan.primaryExecutiveId!, ...plan.secondaryExecutiveIds],
          input.actorId,
          ctx,
        );

        await this.auditLogs.record(
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: 'mailbox.link',
            entityType: 'Mailbox',
            entityId: mailbox.id,
            metadata: {
              correlationId,
              idempotencyKey: input.idempotencyKey,
              clientId: managedClient.id,
              domainId: domain.id,
              serverMailboxId: redemption.mailbox.serverMailboxId,
              redemptionId: redemption.redemptionId,
              tokenFingerprint: tokenFingerprint(input.token),
              primaryExecutiveId: plan.primaryExecutiveId,
              secondaryExecutiveIds: plan.secondaryExecutiveIds,
            },
          },
          ctx,
        );

        const result: LinkMailboxResult = {
          mailboxId: mailbox.id,
          clientId: managedClient.id,
          domainId: domain.id,
          serverMailboxId: redemption.mailbox.serverMailboxId,
          primaryExecutiveId: plan.primaryExecutiveId!,
          secondaryExecutiveIds: plan.secondaryExecutiveIds,
          commandId,
          correlationId,
          businessOperationConfirmed: true,
          commandPersisted: true,
          linkStatus: 'ACTIVE',
        };

        const command = await this.idempotency.claim(
          ctx,
          {
            organizationId: input.organizationId,
            scope: IDEMPOTENCY_SCOPE.MAILBOX_LINK,
            rawIdempotencyKey: input.idempotencyKey,
            payloadHash,
            commandType: 'MAILBOX_LINK_REQUESTED',
            aggregateType: 'MAILBOX',
            aggregateId: mailbox.id,
            correlationId,
            requestedBy: input.actorId,
            commandPayload: {
              serverMailboxId: redemption.mailbox.serverMailboxId,
              serverDomainId: redemption.domain.serverDomainId,
              serverClientId: redemption.client.serverClientId,
              redemptionId: redemption.redemptionId,
              tokenFingerprint: tokenFingerprint(input.token),
              primaryExecutiveId: plan.primaryExecutiveId,
            },
            commandId,
          },
          result as unknown as Record<string, unknown>,
          201,
        );
        // No engine dispatch/advance for this command — the motor was
        // already, authoritatively, called (and its result applied) above,
        // strictly before this transaction opened. There is no pending
        // async work left, so the durable record is complete immediately.
        await this.idempotency.markCompleted(command.id, ctx);

        return { result };
      });

      return { result, httpStatus: 201 };
    } catch (error) {
      if (error instanceof ConflictException || isUniqueConstraintViolation(error)) {
        const raced = await this.idempotency.checkExisting(
          input.organizationId,
          IDEMPOTENCY_SCOPE.MAILBOX_LINK,
          input.idempotencyKey,
          payloadHash,
        );
        if (raced) {
          return {
            result: raced.resultSnapshot as unknown as LinkMailboxResult,
            httpStatus: raced.httpStatusCode ?? 201,
          };
        }
      }
      throw error;
    }
  }
}
