import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxProtocolConfig } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { isUniqueConstraintViolation } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { htmlToPlainText } from '../../infrastructure/security/html-to-plain-text';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ClientEligibilityService } from '../clients/client-eligibility.service';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { IntegrationService } from '../integration/integration.service';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';
import { MailboxProvisioningEventApplier } from './mailbox-provisioning-event-applier';

export interface UpdateMailboxProtocolInput {
  host?: string;
  port?: number;
  encryption?: 'SSL_TLS' | 'STARTTLS' | 'NONE';
  username?: string;
  /** Omitted or empty — preserve the existing encrypted credential. A non-empty value replaces it. */
  password?: string;
  verifyCertificate?: boolean;
}

export interface UpdateMailboxConfigurationInput {
  organizationId: string;
  mailboxId: string;
  name?: string;
  email?: string;
  fromName?: string;
  replyTo?: string | null;
  imap?: UpdateMailboxProtocolInput;
  smtp?: UpdateMailboxProtocolInput;
  /** Key omitted (undefined) => preserve the existing signature untouched. Provided (including empty/normalizes-to-empty) => update or archive, per `normalizeSignatureHtml`. */
  signatureHtml?: string | null;
  /** Both omitted (undefined) => preserve existing assignments untouched. Either provided => full replace using the resolved plan (may end empty, which removes every assignment). */
  primaryExecutiveId?: string | null;
  secondaryExecutiveIds?: string[];
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface UpdateMailboxConfigurationResult {
  mailboxId: string;
  signatureId: string | null;
  primaryExecutiveId: string | null;
  secondaryExecutiveIds: string[];
  commandId: string;
  commandStatus: string;
  correlationId: string;
  businessOperationConfirmed: true;
  commandPersisted: true;
  provisioningStatus: 'PENDING' | 'COMPLETED' | 'FAILED';
}

/**
 * Fase 2 — replaces the frontend-coordinated
 * `PATCH /mailboxes/:id` → `POST .../provision` → `POST .../provision/advance`
 * sequence (see `edit-mailbox-form.tsx`, pre-Fase-2, never transactional,
 * no shared Idempotency-Key, demonstrated to leave orphaned commands in
 * real Postgres data) with one atomic, idempotent operation — the edit-side
 * counterpart of `ConfigureMailboxUseCase`, sharing its executive-validation
 * and provisioning-event-application logic (never duplicated).
 *
 * "Omitted" vs "provided-empty" is meaningful here (never conflated):
 * a field simply absent from the input means "leave as-is"; a field
 * present — even as an empty string, null, or empty array — means
 * "apply this change" (which may mean "clear/archive", per each field's
 * documented rule on `UpdateMailboxConfigurationInput`).
 */
@Injectable()
export class UpdateMailboxConfigurationUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY) private readonly signatureVersions: SignatureVersionRepository,
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly eligibility: ClientEligibilityService,
    private readonly secrets: SecretEncryptionService,
    private readonly htmlSanitizer: HtmlSanitizerService,
    private readonly idempotency: IdempotentOperationService,
    private readonly integration: IntegrationService,
    private readonly executiveValidator: MailboxExecutiveAssignmentValidator,
    private readonly eventApplier: MailboxProvisioningEventApplier,
    private readonly clientVisibility: ClientMailboxVisibilityService,
  ) {}

  async execute(
    input: UpdateMailboxConfigurationInput,
  ): Promise<{ result: UpdateMailboxConfigurationResult; httpStatus: number }> {
    const existing = await this.mailboxes.findById(input.mailboxId);
    if (!existing || existing.organizationId !== input.organizationId) {
      throw new NotFoundException('Mailbox not found.');
    }

    const executivesProvided = input.primaryExecutiveId !== undefined || input.secondaryExecutiveIds !== undefined;
    const signatureProvided = input.signatureHtml !== undefined;

    // Preliminary (fast-fail) executive check — never authoritative on its
    // own; the same check runs again inside the transaction below.
    if (executivesProvided && existing.clientId) {
      await this.executiveValidator.validate({
        organizationId: input.organizationId,
        clientId: existing.clientId,
        primaryExecutiveId: input.primaryExecutiveId,
        secondaryExecutiveIds: input.secondaryExecutiveIds,
      });
    } else if (executivesProvided && !existing.clientId) {
      throw new ConflictException('La cuenta necesita estar vinculada a un cliente antes de asignar ejecutivos.');
    }

    const payloadHash = this.hashInput(input);

    const foundExisting = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE,
      input.idempotencyKey,
      payloadHash,
    );
    if (foundExisting) {
      return {
        result: foundExisting.resultSnapshot as unknown as UpdateMailboxConfigurationResult,
        httpStatus: foundExisting.httpStatusCode ?? 201,
      };
    }

    if (existing.clientId) {
      const managedClient = await this.managedClients.findById(existing.clientId);
      if (managedClient) {
        await this.eligibility.assertEligibleForPublish(managedClient);
      }
    }

    try {
      const { result, command } = await this.tx.run(async (ctx) => {
        const mailboxBefore = await this.mailboxes.findById(input.mailboxId, ctx);
        if (!mailboxBefore || mailboxBefore.organizationId !== input.organizationId) {
          throw new NotFoundException('Mailbox not found.');
        }

        // Authoritative executive check — inside the SAME transaction
        // context as the assignment writes below, closing the race
        // window between the preliminary check (if any) and the commit.
        const plan = this.executiveValidator.plan(input.primaryExecutiveId, input.secondaryExecutiveIds);
        if (executivesProvided && mailboxBefore.clientId) {
          await this.executiveValidator.validate(
            {
              organizationId: input.organizationId,
              clientId: mailboxBefore.clientId,
              primaryExecutiveId: plan.primaryExecutiveId,
              secondaryExecutiveIds: plan.secondaryExecutiveIds,
            },
            ctx,
          );
        }

        const patch: Record<string, unknown> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.email !== undefined) patch.email = input.email;
        if (input.fromName !== undefined) patch.fromName = input.fromName;
        if (input.replyTo !== undefined) patch.replyTo = input.replyTo;
        if (input.imap !== undefined) patch.imap = this.toProtocolPatch(input.imap);
        if (input.smtp !== undefined) patch.smtp = this.toProtocolPatch(input.smtp);

        const correlationId = input.correlationId ?? `corr_${mailboxBefore.id}`;
        const commandId = `cmd_${randomUUID()}`;
        patch.lastProvisionCommandId = commandId;
        patch.provisioningStatus = 'PROVISION_REQUESTED';

        const mailbox = await this.mailboxes.update(mailboxBefore.id, patch, ctx);

        let signatureId: string | null = null;
        if (signatureProvided) {
          const normalized = this.normalizeSignatureHtml(input.signatureHtml);
          const existingSignature = await this.signatures.findByMailbox(mailbox.id, ctx);
          if (normalized) {
            const plainText = htmlToPlainText(normalized);
            let signature = existingSignature;
            if (!signature) {
              signature = await this.signatures.create({ organizationId: input.organizationId, mailboxId: mailbox.id }, ctx);
            }
            const version = await this.signatureVersions.create(
              { signatureId: signature.id, htmlContent: normalized, plainTextContent: plainText, createdBy: input.actorId },
              ctx,
            );
            await this.signatures.update(signature.id, { activeVersionId: version.id, status: 'ACTIVE' }, ctx);
            signatureId = signature.id;
          } else if (existingSignature) {
            // §"Firma enviada vacía: eliminar o desactivar únicamente si
            // el contrato lo define expresamente" — this use case's
            // contract: archive it (soft, reversible — same status the
            // existing standalone signature-management screen already
            // uses for "Archivar"), never a hard delete.
            await this.signatures.update(existingSignature.id, { status: 'ARCHIVED' }, ctx);
            signatureId = existingSignature.id;
          }
        } else {
          const existingSignature = await this.signatures.findByMailbox(mailbox.id, ctx);
          signatureId = existingSignature?.id ?? null;
        }

        if (executivesProvided) {
          const current = await this.assignments.findByMailbox(mailbox.id, ctx);
          const keep = new Set([plan.primaryExecutiveId, ...plan.secondaryExecutiveIds].filter((id): id is string => !!id));
          const removed: string[] = [];
          for (const assignment of current) {
            if (!keep.has(assignment.userId)) {
              await this.assignments.remove(mailbox.id, assignment.userId, ctx);
              removed.push(assignment.userId);
            }
          }
          if (plan.primaryExecutiveId) {
            await this.assignments.upsert(
              { organizationId: input.organizationId, mailboxId: mailbox.id, userId: plan.primaryExecutiveId, role: 'PRIMARY', assignedBy: input.actorId },
              ctx,
            );
          }
          for (const userId of plan.secondaryExecutiveIds) {
            await this.assignments.upsert(
              { organizationId: input.organizationId, mailboxId: mailbox.id, userId, role: 'SECONDARY', assignedBy: input.actorId },
              ctx,
            );
          }

          // §10 — grant derived visibility to everyone now assigned, and
          // drop it for anyone removed above who has no other mailbox left
          // for this client (a MANUAL grant is never touched).
          if (mailboxBefore.clientId) {
            await this.clientVisibility.grantForExecutives(
              input.organizationId,
              mailboxBefore.clientId,
              [...keep],
              input.actorId,
              ctx,
            );
            for (const userId of removed) {
              await this.clientVisibility.revokeIfNoRemainingMailbox(
                input.organizationId,
                mailboxBefore.clientId,
                userId,
                ctx,
              );
            }
          }
        }

        await this.auditLogs.record(
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: 'mailbox.update_configuration',
            entityType: 'Mailbox',
            entityId: mailbox.id,
            metadata: { correlationId, idempotencyKey: input.idempotencyKey, commandId },
          },
          ctx,
        );

        const commandPayload = this.buildProvisioningPayload(mailbox, input);

        const result: UpdateMailboxConfigurationResult = {
          mailboxId: mailbox.id,
          signatureId,
          primaryExecutiveId: executivesProvided ? plan.primaryExecutiveId : null,
          secondaryExecutiveIds: executivesProvided ? plan.secondaryExecutiveIds : [],
          commandId,
          commandStatus: 'REQUESTED',
          correlationId,
          businessOperationConfirmed: true,
          commandPersisted: true,
          provisioningStatus: 'PENDING',
        };

        const command = await this.idempotency.claim(
          ctx,
          {
            organizationId: input.organizationId,
            scope: IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE,
            rawIdempotencyKey: input.idempotencyKey,
            payloadHash,
            commandType: 'MAILBOX_PROVISION_REQUESTED',
            aggregateType: 'MAILBOX',
            aggregateId: mailbox.id,
            correlationId,
            requestedBy: input.actorId,
            commandPayload,
            commandId,
          },
          result as unknown as Record<string, unknown>,
          201,
        );

        return { result, command };
      });

      // Post-commit — dispatch + advance, never the browser. Same
      // failure-isolation contract as ConfigureMailboxUseCase: a
      // simulator failure here never reverts the committed update, never
      // creates a second command, and is logged sanitized with the same
      // correlationId.
      try {
        const dispatched = await this.integration.dispatchExistingCommand(command, input.actorId);
        result.commandStatus = dispatched.status;
        const events = await this.integration.advance(input.organizationId, command.commandId, 'ALL', input.actorId);
        for (const event of events) {
          await this.eventApplier.apply(
            input.organizationId,
            { id: result.mailboxId, organizationId: input.organizationId },
            event,
            input.actorId,
          );
          if (event.eventType === 'MAILBOX_PROVISION_COMPLETED') result.provisioningStatus = 'COMPLETED';
          if (event.eventType === 'MAILBOX_PROVISION_FAILED') result.provisioningStatus = 'FAILED';
        }
        await this.idempotency.refreshResultSnapshot(command.id, result as unknown as Record<string, unknown>);
      } catch (dispatchError) {
        console.error(
          JSON.stringify({
            event: 'update_mailbox_configuration.dispatch_failed',
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
          IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE,
          input.idempotencyKey,
          payloadHash,
        );
        if (raced) {
          return {
            result: raced.resultSnapshot as unknown as UpdateMailboxConfigurationResult,
            httpStatus: raced.httpStatusCode ?? 201,
          };
        }
        if (isUniqueConstraintViolation(error)) {
          throw new ConflictException('Esta dirección de correo ya está en uso.');
        }
      }
      throw error;
    }
  }

  private toProtocolPatch(input: UpdateMailboxProtocolInput): Partial<MailboxProtocolConfig> {
    const patch: Partial<MailboxProtocolConfig> = {};
    if (input.host !== undefined) patch.host = input.host;
    if (input.port !== undefined) patch.port = input.port;
    if (input.encryption !== undefined) patch.encryption = input.encryption;
    if (input.username !== undefined) patch.username = input.username;
    if (input.verifyCertificate !== undefined) patch.verifyCertificate = input.verifyCertificate;
    // Omitted or empty password — never touch the existing encrypted
    // secret. A non-empty value is encrypted and replaces it.
    if (input.password) patch.secretCiphertext = this.secrets.encrypt(input.password);
    return patch;
  }

  private normalizeSignatureHtml(signatureHtml: string | null | undefined): string | null {
    if (!signatureHtml) return null;
    const sanitized = this.htmlSanitizer.sanitize(signatureHtml);
    const plain = htmlToPlainText(sanitized).trim();
    return plain.length > 0 ? sanitized : null;
  }

  private hashInput(input: UpdateMailboxConfigurationInput): string {
    const plan = this.executiveValidator.plan(input.primaryExecutiveId, input.secondaryExecutiveIds);
    return hashLogicalPayload({
      mailboxId: input.mailboxId,
      name: input.name ?? null,
      email: input.email?.toLowerCase() ?? null,
      fromName: input.fromName ?? null,
      replyTo: input.replyTo === undefined ? undefined : input.replyTo,
      imap: input.imap
        ? {
            host: input.imap.host,
            port: input.imap.port,
            encryption: input.imap.encryption,
            username: input.imap.username,
            verifyCertificate: input.imap.verifyCertificate,
            hasNewPassword: !!input.imap.password,
          }
        : undefined,
      smtp: input.smtp
        ? {
            host: input.smtp.host,
            port: input.smtp.port,
            encryption: input.smtp.encryption,
            username: input.smtp.username,
            verifyCertificate: input.smtp.verifyCertificate,
            hasNewPassword: !!input.smtp.password,
          }
        : undefined,
      signatureHtml: input.signatureHtml === undefined ? undefined : this.normalizeSignatureHtml(input.signatureHtml),
      executivesProvided: input.primaryExecutiveId !== undefined || input.secondaryExecutiveIds !== undefined,
      primaryExecutiveId: plan.primaryExecutiveId,
      secondaryExecutiveIds: [...plan.secondaryExecutiveIds].sort(),
    });
  }

  private buildProvisioningPayload(
    mailbox: { id: string; clientId: string | null; domainId: string | null; email: string; fromName: string; replyTo: string | null },
    input: UpdateMailboxConfigurationInput,
  ): Record<string, unknown> {
    return {
      clientId: mailbox.clientId,
      domainId: mailbox.domainId,
      mailboxId: mailbox.id,
      mailbox: {
        email: mailbox.email,
        displayName: mailbox.fromName,
        replyTo: mailbox.replyTo,
        imap: input.imap
          ? {
              host: input.imap.host,
              port: input.imap.port,
              secure: input.imap.encryption !== 'NONE',
              username: input.imap.username,
              credentialReference: `secret_ref_demo_${mailbox.id.slice(0, 8)}_imap`,
            }
          : undefined,
        smtp: input.smtp
          ? {
              host: input.smtp.host,
              port: input.smtp.port,
              secure: input.smtp.encryption !== 'NONE',
              username: input.smtp.username,
              credentialReference: `secret_ref_demo_${mailbox.id.slice(0, 8)}_smtp`,
            }
          : undefined,
      },
    };
  }
}
