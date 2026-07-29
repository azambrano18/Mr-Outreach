import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxProtocolConfig } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { isUniqueConstraintViolation } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import {
  AUDIT_LOG_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { htmlToPlainText } from '../../infrastructure/security/html-to-plain-text';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ClientsService } from '../clients/clients.service';
import { CrmClientEligibilityService } from '../crm-clients/crm-client-eligibility.service';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { IntegrationService } from '../integration/integration.service';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';
import { MailboxProvisioningEventApplier } from './mailbox-provisioning-event-applier';

export interface ConfigureMailboxProtocolInput {
  host: string;
  port: number;
  encryption: 'SSL_TLS' | 'STARTTLS' | 'NONE';
  username: string;
  password: string;
  verifyCertificate: boolean;
}

export interface ConfigureMailboxInput {
  organizationId: string;
  crmClientId: number;
  domainName: string;
  email: string;
  fromName: string;
  replyTo?: string | null;
  imap: ConfigureMailboxProtocolInput;
  smtp: ConfigureMailboxProtocolInput;
  signatureHtml?: string | null;
  primaryExecutiveId?: string | null;
  secondaryExecutiveIds?: string[];
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface ConfigureMailboxResult {
  mailboxId: string;
  clientId: string;
  domainId: string;
  signatureId: string | null;
  primaryExecutiveId: string | null;
  secondaryExecutiveIds: string[];
  commandId: string;
  commandStatus: string;
  correlationId: string;
  /** Always true once this is returned — the business transaction already committed. */
  businessOperationConfirmed: true;
  /** Always true once this is returned — the IntegrationCommand row is durably persisted. */
  commandPersisted: true;
  /** The engine-reported outcome of the post-commit simulation — independent of businessOperationConfirmed. */
  provisioningStatus: 'PENDING' | 'COMPLETED' | 'FAILED';
}

const DOMAIN_NAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Fase 2, Caso A — collapses "crear cuenta → vincular dominio → guardar
 * firma → asignar ejecutivo → crear comando" (today: 4-5 separate frontend
 * requests, see Paso 1 diagnostic) into one atomic, idempotent backend use
 * case. CRM eligibility is checked before the transaction opens (never
 * inside a Prisma `$transaction`); the command row is created *inside* the
 * same transaction as every other write, at REQUESTED status; dispatch to
 * the (simulated) engine port happens strictly after commit.
 */
@Injectable()
export class ConfigureMailboxUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY) private readonly signatureVersions: SignatureVersionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly clients: ClientsService,
    private readonly crmEligibility: CrmClientEligibilityService,
    private readonly secrets: SecretEncryptionService,
    private readonly htmlSanitizer: HtmlSanitizerService,
    private readonly idempotency: IdempotentOperationService,
    private readonly integration: IntegrationService,
    private readonly executiveValidator: MailboxExecutiveAssignmentValidator,
    private readonly eventApplier: MailboxProvisioningEventApplier,
    private readonly clientVisibility: ClientMailboxVisibilityService,
  ) {}

  async execute(input: ConfigureMailboxInput): Promise<{ result: ConfigureMailboxResult; httpStatus: number }> {
    this.assertValidDomain(input.domainName);
    this.assertValidEmail(input.email);
    this.assertEmailMatchesDomain(input.email, input.domainName);

    const payloadHash = this.hashInput(input);

    const existing = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE,
      input.idempotencyKey,
      payloadHash,
    );
    if (existing) {
      return {
        result: existing.resultSnapshot as unknown as ConfigureMailboxResult,
        httpStatus: existing.httpStatusCode ?? 201,
      };
    }

    // §"El CRM se consulta antes de abrir la transacción local" — never inside $transaction.
    const crmClient = await this.crmEligibility.getVerifiedActiveClient(input.crmClientId);

    try {
      const { result, command } = await this.tx.run(async (ctx) => {
        const managedClient = await this.clients.upsertFromVerifiedCrmClient(
          input.organizationId,
          crmClient,
          input.actorId,
          {},
          ctx,
        );

        let domain = await this.domains.findByName(input.organizationId, input.domainName, ctx);
        if (domain && domain.clientId !== managedClient.id) {
          throw new ConflictException('Este dominio ya pertenece a otro cliente.');
        }
        if (!domain) {
          domain = await this.domains.create(
            {
              organizationId: input.organizationId,
              clientId: managedClient.id,
              domainName: input.domainName,
              createdBy: input.actorId,
            },
            ctx,
          );
        }

        const encryptedImap = this.encryptProtocol(input.imap);
        const encryptedSmtp = this.encryptProtocol(input.smtp);

        let mailbox = await this.mailboxes.findByEmail(input.organizationId, input.email, ctx);
        if (mailbox && mailbox.clientId && mailbox.clientId !== managedClient.id) {
          throw new ConflictException('Esta dirección de correo ya está configurada para otro cliente.');
        }
        if (mailbox) {
          mailbox = await this.mailboxes.update(
            mailbox.id,
            {
              fromName: input.fromName,
              replyTo: input.replyTo ?? null,
              clientId: managedClient.id,
              domainId: domain.id,
              imap: encryptedImap,
              smtp: encryptedSmtp,
            },
            ctx,
          );
        } else {
          mailbox = await this.mailboxes.create(
            {
              organizationId: input.organizationId,
              name: input.fromName,
              email: input.email,
              fromName: input.fromName,
              replyTo: input.replyTo ?? null,
              imap: encryptedImap,
              smtp: encryptedSmtp,
            },
            ctx,
          );
          mailbox = await this.mailboxes.update(
            mailbox.id,
            { clientId: managedClient.id, domainId: domain.id },
            ctx,
          );
        }

        let signatureId: string | null = null;
        const normalizedSignatureHtml = this.normalizeSignatureHtml(input.signatureHtml);
        if (normalizedSignatureHtml) {
          const sanitizedHtml = normalizedSignatureHtml;
          const plainText = htmlToPlainText(sanitizedHtml);
          let signature = await this.signatures.findByMailbox(mailbox.id, ctx);
          if (!signature) {
            signature = await this.signatures.create(
              { organizationId: input.organizationId, mailboxId: mailbox.id },
              ctx,
            );
          }
          const version = await this.signatureVersions.create(
            { signatureId: signature.id, htmlContent: sanitizedHtml, plainTextContent: plainText, createdBy: input.actorId },
            ctx,
          );
          await this.signatures.update(signature.id, { activeVersionId: version.id, status: 'ACTIVE' }, ctx);
          signatureId = signature.id;
        }

        const { primaryExecutiveId, secondaryExecutiveIds: secondaryIds } = this.executiveValidator.plan(
          input.primaryExecutiveId,
          input.secondaryExecutiveIds,
        );
        // Authoritative check — always inside the transaction, on the
        // SAME TransactionContext as the writes below, so an executive
        // deactivated/unassigned between any preliminary check and this
        // point is still caught before anything commits.
        if (primaryExecutiveId || secondaryIds.length > 0) {
          await this.executiveValidator.validate(
            {
              organizationId: input.organizationId,
              clientId: managedClient.id,
              primaryExecutiveId,
              secondaryExecutiveIds: secondaryIds,
            },
            ctx,
          );
        }
        if (primaryExecutiveId) {
          await this.assignments.upsert(
            {
              organizationId: input.organizationId,
              mailboxId: mailbox.id,
              userId: primaryExecutiveId,
              role: 'PRIMARY',
              assignedBy: input.actorId,
            },
            ctx,
          );
        }
        for (const userId of secondaryIds) {
          await this.assignments.upsert(
            { organizationId: input.organizationId, mailboxId: mailbox.id, userId, role: 'SECONDARY', assignedBy: input.actorId },
            ctx,
          );
        }

        // §10 — every assigned executive automatically gets client
        // visibility, with no prior manual client assignment required.
        const assignedExecutiveIds = [primaryExecutiveId, ...secondaryIds].filter((id): id is string => !!id);
        if (assignedExecutiveIds.length > 0) {
          await this.clientVisibility.grantForExecutives(
            input.organizationId,
            managedClient.id,
            assignedExecutiveIds,
            input.actorId,
            ctx,
          );
        }

        await this.auditLogs.record(
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: 'mailbox.configure',
            entityType: 'Mailbox',
            entityId: mailbox.id,
            metadata: {
              correlationId: input.correlationId ?? null,
              idempotencyKey: input.idempotencyKey,
              clientId: managedClient.id,
              domainId: domain.id,
              email: mailbox.email,
            },
          },
          ctx,
        );

        const correlationId = input.correlationId ?? `corr_${mailbox.id}`;
        const commandPayload = this.buildProvisioningPayload(mailbox.id, managedClient.id, domain.id, input);
        const commandId = `cmd_${randomUUID()}`;

        // §"No debe existir una cuenta configurada sin referencia al
        // comando que originó su aprovisionamiento" — saved in the SAME
        // transaction as the command's own claim below, never after.
        mailbox = await this.mailboxes.update(
          mailbox.id,
          { lastProvisionCommandId: commandId, provisioningStatus: 'PROVISION_REQUESTED' },
          ctx,
        );

        const result: ConfigureMailboxResult = {
          mailboxId: mailbox.id,
          clientId: managedClient.id,
          domainId: domain.id,
          signatureId,
          primaryExecutiveId,
          secondaryExecutiveIds: secondaryIds,
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

      // Dispatch to the (simulated) port strictly after commit — never
      // while the local transaction is open, and in its OWN try/catch,
      // deliberately separate from the transaction-race handling below:
      // a dispatch failure here is never a reason to fail the HTTP
      // request — the business operation (ManagedClient/Domain/Mailbox/
      // Signature/asignaciones/auditoría) already committed successfully
      // and must never be reported as failed. The command row simply
      // stays at REQUESTED (never ACCEPTED) — durably persisted, visible
      // via GET /integration/commands, retriable through the existing
      // advance/reprocess mechanisms. No second command is ever created
      // for this same attempt.
      try {
        const dispatched = await this.integration.dispatchExistingCommand(command, input.actorId);
        result.commandStatus = dispatched.status;
        // §"El backend puede y debe encadenar dispatch+advance" — the
        // browser never coordinates this. Reaching the engine's terminal
        // event here is what actually makes the account "vinculada";
        // without this the mailbox would stay NOT_PROVISIONED forever.
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
        // Keep the persisted idempotent snapshot in sync so a future
        // retry reflects the real dispatch+advance outcome, not the
        // pre-dispatch "REQUESTED"/"PENDING" frozen at claim() time.
        await this.idempotency.refreshResultSnapshot(command.id, result as unknown as Record<string, unknown>);
      } catch (dispatchError) {
        // §"logs deben registrar el fallo sanitizado usando el mismo
        // correlationId" — never the raw error object (could carry
        // driver/connection details), never any credential.
        console.error(
          JSON.stringify({
            event: 'configure_mailbox.dispatch_failed',
            correlationId: result.correlationId,
            commandId: result.commandId,
            organizationId: input.organizationId,
            message: dispatchError instanceof Error ? dispatchError.message : 'unknown error',
          }),
        );
        // result.commandStatus stays 'REQUESTED' — the API never claims
        // the simulator completed provisioning when it didn't.
      }

      return { result, httpStatus: 201 };
    } catch (error) {
      // Either our own idempotency.claim() lost the race (raw ConflictException,
      // §concurrencia), or two simultaneous requests for the same key both
      // tried to create the same Domain/Mailbox row before either committed
      // (a raw Postgres unique-constraint violation on a *different* table,
      // surfacing here as the transaction's rejection) — both cases mean
      // "someone else may have already finished this exact operation".
      if (error instanceof ConflictException || isUniqueConstraintViolation(error)) {
        const raced = await this.idempotency.checkExisting(
          input.organizationId,
          IDEMPOTENCY_SCOPE.MAILBOX_CONFIGURE,
          input.idempotencyKey,
          payloadHash,
        );
        if (raced) {
          return {
            result: raced.resultSnapshot as unknown as ConfigureMailboxResult,
            httpStatus: raced.httpStatusCode ?? 201,
          };
        }
        if (isUniqueConstraintViolation(error)) {
          throw new ConflictException('Este dominio o esta dirección de correo ya están en uso.');
        }
      }
      throw error;
    }
  }

  private hashInput(input: ConfigureMailboxInput): string {
    // §"Los IDs deben normalizarse y deduplicarse antes del hash idempotente" —
    // same plan() used for the actual assignment, so a request that only
    // differs by executive-id ordering or a redundant primary-as-secondary
    // is correctly treated as the same logical payload.
    const { primaryExecutiveId, secondaryExecutiveIds } = this.executiveValidator.plan(
      input.primaryExecutiveId,
      input.secondaryExecutiveIds,
    );
    return hashLogicalPayload({
      crmClientId: input.crmClientId,
      domainName: input.domainName.toLowerCase(),
      email: input.email.toLowerCase(),
      fromName: input.fromName,
      replyTo: input.replyTo ?? null,
      imap: {
        host: input.imap.host,
        port: input.imap.port,
        encryption: input.imap.encryption,
        username: input.imap.username,
        verifyCertificate: input.imap.verifyCertificate,
      },
      smtp: {
        host: input.smtp.host,
        port: input.smtp.port,
        encryption: input.smtp.encryption,
        username: input.smtp.username,
        verifyCertificate: input.smtp.verifyCertificate,
      },
      // Normalized empty-HTML (after sanitization would strip to nothing)
      // is treated the same as "no signature" — see assertNormalizedSignature.
      signatureHtml: this.normalizeSignatureHtml(input.signatureHtml),
      primaryExecutiveId,
      secondaryExecutiveIds: [...secondaryExecutiveIds].sort(),
    });
  }

  /** §"HTML vacío normalizado debe tratarse como ausencia de firma" — never hashes/saves a signature that sanitizes down to nothing. */
  private normalizeSignatureHtml(signatureHtml: string | null | undefined): string | null {
    if (!signatureHtml) return null;
    const sanitized = this.htmlSanitizer.sanitize(signatureHtml);
    const plain = htmlToPlainText(sanitized).trim();
    return plain.length > 0 ? sanitized : null;
  }

  private encryptProtocol(input: ConfigureMailboxProtocolInput): MailboxProtocolConfig {
    return {
      host: input.host,
      port: input.port,
      encryption: input.encryption,
      username: input.username,
      verifyCertificate: input.verifyCertificate,
      secretCiphertext: this.secrets.encrypt(input.password),
    };
  }

  private buildProvisioningPayload(
    mailboxId: string,
    clientId: string,
    domainId: string,
    input: ConfigureMailboxInput,
  ): Record<string, unknown> {
    return {
      clientId,
      domainId,
      mailboxId,
      mailbox: {
        email: input.email,
        displayName: input.fromName,
        replyTo: input.replyTo ?? null,
        imap: {
          host: input.imap.host,
          port: input.imap.port,
          secure: input.imap.encryption !== 'NONE',
          username: input.imap.username,
          credentialReference: `secret_ref_demo_${mailboxId.slice(0, 8)}_imap`,
        },
        smtp: {
          host: input.smtp.host,
          port: input.smtp.port,
          secure: input.smtp.encryption !== 'NONE',
          username: input.smtp.username,
          credentialReference: `secret_ref_demo_${mailboxId.slice(0, 8)}_smtp`,
        },
      },
    };
  }

  private assertValidDomain(domainName: string): void {
    if (!DOMAIN_NAME_PATTERN.test(domainName)) {
      throw new BadRequestException('Formato de dominio inválido.');
    }
  }

  private assertValidEmail(email: string): void {
    if (!EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('Formato de correo inválido.');
    }
  }

  private assertEmailMatchesDomain(email: string, domainName: string): void {
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (emailDomain !== domainName.toLowerCase()) {
      throw new BadRequestException('El correo debe pertenecer al dominio indicado.');
    }
  }
}
