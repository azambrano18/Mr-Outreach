import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ClientsService } from '../clients/clients.service';
import { CrmClientEligibilityService } from '../crm-clients/crm-client-eligibility.service';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { ConfigureMailboxInput, ConfigureMailboxUseCase } from './configure-mailbox.use-case';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';
import { MailboxProvisioningEventApplier } from './mailbox-provisioning-event-applier';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('ConfigureMailboxUseCase', () => {
  let domains: jest.Mocked<DomainRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let signatures: jest.Mocked<SignatureRepository>;
  let signatureVersions: jest.Mocked<SignatureVersionRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let clients: jest.Mocked<Pick<ClientsService, 'upsertFromVerifiedCrmClient'>>;
  let crmEligibility: jest.Mocked<Pick<CrmClientEligibilityService, 'getVerifiedActiveClient'>>;
  let secrets: jest.Mocked<Pick<SecretEncryptionService, 'encrypt' | 'decrypt'>>;
  let htmlSanitizer: jest.Mocked<Pick<HtmlSanitizerService, 'sanitize'>>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'refreshResultSnapshot'>>;
  let integration: jest.Mocked<Pick<IntegrationService, 'dispatchExistingCommand' | 'advance'>>;
  let executiveValidator: jest.Mocked<Pick<MailboxExecutiveAssignmentValidator, 'plan' | 'validate'>>;
  let eventApplier: jest.Mocked<Pick<MailboxProvisioningEventApplier, 'apply'>>;
  let clientVisibility: jest.Mocked<Pick<ClientMailboxVisibilityService, 'grantForExecutives' | 'revokeIfNoRemainingMailbox'>>;
  let useCase: ConfigureMailboxUseCase;

  const orgId = 'org_1';
  const crmClient = { crmClientId: 7, name: 'Cliente Demo', rut: '76.111.222-3', rubro: 'Servicios', status: 'ACTIVO' };
  const managedClient = { id: 'mc_1', organizationId: orgId, crmClientId: 7 } as never;

  function baseInput(overrides: Partial<ConfigureMailboxInput> = {}): ConfigureMailboxInput {
    return {
      organizationId: orgId,
      crmClientId: 7,
      domainName: 'ventas.cl',
      email: 'contacto@ventas.cl',
      fromName: 'Equipo de Ventas',
      imap: { host: 'imap.ventas.cl', port: 993, encryption: 'SSL_TLS', username: 'contacto', password: 'imap-pass', verifyCertificate: true },
      smtp: { host: 'smtp.ventas.cl', port: 587, encryption: 'STARTTLS', username: 'contacto', password: 'smtp-pass', verifyCertificate: true },
      actorId: 'admin_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    domains = { findById: jest.fn(), findByClient: jest.fn(), findByName: jest.fn().mockResolvedValue(null), findAll: jest.fn(), create: jest.fn(), update: jest.fn() };
    mailboxes = { findById: jest.fn(), findByEmail: jest.fn().mockResolvedValue(null), findByServerMailboxId: jest.fn(), findAll: jest.fn(), create: jest.fn(), createLinked: jest.fn(), update: jest.fn() };
    assignments = { upsert: jest.fn(), remove: jest.fn(), findByMailbox: jest.fn(), findByUser: jest.fn(), findAllByOrganization: jest.fn().mockResolvedValue([]) };
    signatures = { findById: jest.fn(), findByMailbox: jest.fn().mockResolvedValue(null), findAllByOrganization: jest.fn(), create: jest.fn(), update: jest.fn() };
    signatureVersions = { create: jest.fn(), findById: jest.fn(), findBySignature: jest.fn() };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    clients = { upsertFromVerifiedCrmClient: jest.fn().mockResolvedValue(managedClient) };
    crmEligibility = { getVerifiedActiveClient: jest.fn().mockResolvedValue(crmClient) };
    secrets = { encrypt: jest.fn((v: string) => `enc(${v})`), decrypt: jest.fn() };
    htmlSanitizer = { sanitize: jest.fn((html: string) => html) };
    idempotency = {
      checkExisting: jest.fn().mockResolvedValue(null),
      claim: jest.fn(),
      refreshResultSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    integration = {
      dispatchExistingCommand: jest.fn().mockImplementation(async (command) => ({ ...command, status: 'ACCEPTED' })),
      advance: jest.fn().mockResolvedValue([{ eventType: 'MAILBOX_PROVISION_COMPLETED', commandId: 'cmd_1' }]),
    };
    executiveValidator = {
      plan: jest.fn((primary?: string | null, secondary?: string[]) => {
        const primaryExecutiveId = primary ?? null;
        const secondaryExecutiveIds = [...new Set(secondary ?? [])].filter((id) => id !== primaryExecutiveId);
        return { primaryExecutiveId, secondaryExecutiveIds };
      }),
      validate: jest.fn().mockResolvedValue(undefined),
    };
    eventApplier = { apply: jest.fn().mockResolvedValue(undefined) };
    clientVisibility = { grantForExecutives: jest.fn().mockResolvedValue(undefined), revokeIfNoRemainingMailbox: jest.fn().mockResolvedValue(undefined) };

    domains.create.mockResolvedValue({ id: 'domain_1', organizationId: orgId, clientId: 'mc_1', domainName: 'ventas.cl' } as never);
    mailboxes.create.mockResolvedValue({ id: 'mailbox_1', organizationId: orgId, email: 'contacto@ventas.cl' } as never);
    mailboxes.update.mockResolvedValue({ id: 'mailbox_1', organizationId: orgId, email: 'contacto@ventas.cl', clientId: 'mc_1', domainId: 'domain_1' } as never);
    idempotency.claim.mockImplementation(
      async (_ctx, input) =>
        ({
          id: 'row_1',
          organizationId: input.organizationId,
          commandId: input.commandId ?? 'cmd_fallback',
          commandType: input.commandType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          schemaVersion: '1.0',
          idempotencyKey: `${input.scope}:${input.rawIdempotencyKey}`,
          correlationId: input.correlationId,
          payload: input.commandPayload,
          status: 'REQUESTED',
          attemptCount: 0,
          nextAttemptAt: null,
          lastError: null,
          requestedBy: input.requestedBy,
          createdAt: new Date(),
          sentAt: null,
          acceptedAt: null,
          completedAt: null,
          payloadHash: input.payloadHash,
          resultSnapshot: null,
          httpStatusCode: null,
        }) as never,
    );

    useCase = new ConfigureMailboxUseCase(
      new FakeTransactionManager(),
      domains,
      mailboxes,
      assignments,
      signatures,
      signatureVersions,
      auditLogs,
      clients as unknown as ClientsService,
      crmEligibility as unknown as CrmClientEligibilityService,
      secrets as unknown as SecretEncryptionService,
      htmlSanitizer as unknown as HtmlSanitizerService,
      idempotency as unknown as IdempotentOperationService,
      integration as unknown as IntegrationService,
      executiveValidator as unknown as MailboxExecutiveAssignmentValidator,
      eventApplier as unknown as MailboxProvisioningEventApplier,
      clientVisibility as never,
    );
  });

  it('configures a mailbox end-to-end: creates domain, mailbox, claims the command, dispatches after commit', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result.mailboxId).toBe('mailbox_1');
    expect(result.clientId).toBe('mc_1');
    expect(result.domainId).toBe('domain_1');
    expect(domains.create).toHaveBeenCalledTimes(1);
    expect(mailboxes.create).toHaveBeenCalledTimes(1);
    expect(auditLogs.record).toHaveBeenCalledTimes(1);
    expect(idempotency.claim).toHaveBeenCalledTimes(1);
    expect(integration.dispatchExistingCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid domain format before touching the CRM or the transaction', async () => {
    await expect(useCase.execute(baseInput({ domainName: 'not a domain' }))).rejects.toThrow(BadRequestException);
    expect(crmEligibility.getVerifiedActiveClient).not.toHaveBeenCalled();
  });

  it('rejects an email that does not belong to the given domain', async () => {
    await expect(
      useCase.execute(baseInput({ email: 'contacto@otrodominio.cl' })),
    ).rejects.toThrow(BadRequestException);
    expect(crmEligibility.getVerifiedActiveClient).not.toHaveBeenCalled();
  });

  it('propagates 409 when the CRM reports the client inactive', async () => {
    crmEligibility.getVerifiedActiveClient.mockRejectedValue(new ConflictException('inactive'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(domains.create).not.toHaveBeenCalled();
  });

  it('propagates 503 when the CRM is unavailable, without writing anything', async () => {
    crmEligibility.getVerifiedActiveClient.mockRejectedValue(new ServiceUnavailableException('down'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ServiceUnavailableException);
    expect(domains.create).not.toHaveBeenCalled();
    expect(mailboxes.create).not.toHaveBeenCalled();
  });

  it('propagates 404 when the CRM client does not exist', async () => {
    crmEligibility.getVerifiedActiveClient.mockRejectedValue(new NotFoundException('missing'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('returns the persisted result on an idempotent retry (same key, same payload) without repeating any write', async () => {
    const previousResult = { mailboxId: 'mailbox_1', clientId: 'mc_1', domainId: 'domain_1', signatureId: null, primaryExecutiveId: null, secondaryExecutiveIds: [], commandId: 'cmd_prev', commandStatus: 'REQUESTED', correlationId: 'corr_prev' };
    idempotency.checkExisting.mockResolvedValue({ resultSnapshot: previousResult, httpStatusCode: 201 } as never);

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result).toEqual(previousResult);
    expect(crmEligibility.getVerifiedActiveClient).not.toHaveBeenCalled();
    expect(domains.create).not.toHaveBeenCalled();
    expect(mailboxes.create).not.toHaveBeenCalled();
    expect(integration.dispatchExistingCommand).not.toHaveBeenCalled();
  });

  it('lets a 409 from checkExisting (same key, different payload) propagate as-is', async () => {
    idempotency.checkExisting.mockRejectedValue(new ConflictException('payload mismatch'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(crmEligibility.getVerifiedActiveClient).not.toHaveBeenCalled();
  });

  it('recovers the winning result when claim() loses a concurrency race (unique-constraint conflict)', async () => {
    idempotency.claim.mockRejectedValue(new ConflictException('raced'));
    const winnerResult = { mailboxId: 'mailbox_1', clientId: 'mc_1', domainId: 'domain_1', signatureId: null, primaryExecutiveId: null, secondaryExecutiveIds: [], commandId: 'cmd_winner', commandStatus: 'REQUESTED', correlationId: 'corr_winner' };
    idempotency.checkExisting
      .mockResolvedValueOnce(null) // pre-transaction check: nothing yet
      .mockResolvedValueOnce({ resultSnapshot: winnerResult, httpStatusCode: 201 } as never); // post-conflict recovery

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result).toEqual(winnerResult);
    expect(integration.dispatchExistingCommand).not.toHaveBeenCalled();
  });

  it('creates a signature (sanitized) when signatureHtml is provided', async () => {
    signatures.create.mockResolvedValue({ id: 'sig_1', organizationId: orgId, mailboxId: 'mailbox_1', status: 'ACTIVE', activeVersionId: null } as never);
    signatureVersions.create.mockResolvedValue({ id: 'ver_1', signatureId: 'sig_1', versionNumber: 1, htmlContent: '<p>Hola</p>', plainTextContent: 'Hola', createdAt: new Date(), createdBy: 'admin_1' } as never);

    const { result } = await useCase.execute(baseInput({ signatureHtml: '<p>Hola</p><script>evil()</script>' }));

    expect(htmlSanitizer.sanitize).toHaveBeenCalledWith('<p>Hola</p><script>evil()</script>');
    expect(signatures.create).toHaveBeenCalledTimes(1);
    expect(signatureVersions.create).toHaveBeenCalledTimes(1);
    expect(result.signatureId).toBe('sig_1');
  });

  it('assigns the primary and secondary executives when provided', async () => {
    await useCase.execute(baseInput({ primaryExecutiveId: 'exec_1', secondaryExecutiveIds: ['exec_2', 'exec_1'] }));

    expect(assignments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'exec_1', role: 'PRIMARY' }),
      expect.anything(),
    );
    expect(assignments.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'exec_2', role: 'SECONDARY' }),
      expect.anything(),
    );
    // exec_1 appears both as primary and (de-duplicated) in the secondary list input — never assigned twice as secondary.
    expect(assignments.upsert).toHaveBeenCalledTimes(2);
  });

  it('rejects reusing a domain that already belongs to a different client', async () => {
    domains.findByName.mockResolvedValue({ id: 'domain_1', organizationId: orgId, clientId: 'other_client' } as never);
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('rolls back everything (no audit, no claim, no dispatch) when saving the signature fails', async () => {
    signatures.create.mockRejectedValue(new Error('db exploded'));
    await expect(useCase.execute(baseInput({ signatureHtml: '<p>Hola</p>' }))).rejects.toThrow('db exploded');
    expect(auditLogs.record).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(integration.dispatchExistingCommand).not.toHaveBeenCalled();
  });

  it('never persists a plaintext password anywhere in the command payload', async () => {
    await useCase.execute(baseInput());
    const claimCall = idempotency.claim.mock.calls[0][1];
    const payloadJson = JSON.stringify(claimCall.commandPayload);
    expect(payloadJson).not.toContain('imap-pass');
    expect(payloadJson).not.toContain('smtp-pass');
  });

  it('still returns success when the post-commit simulated dispatch fails — never rolls back or fails the request', async () => {
    integration.dispatchExistingCommand.mockRejectedValue(new Error('simulated engine hiccup'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    // The API never claims the simulator completed — status stays REQUESTED,
    // never ACCEPTED, since dispatch never actually succeeded.
    expect(result.commandStatus).toBe('REQUESTED');
    expect(domains.create).toHaveBeenCalledTimes(1);
    expect(mailboxes.create).toHaveBeenCalledTimes(1);
    expect(idempotency.claim).toHaveBeenCalledTimes(1);

    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe('configure_mailbox.dispatch_failed');
    expect(logged.correlationId).toBe(result.correlationId);
    expect(JSON.stringify(logged)).not.toContain('imap-pass');
    expect(JSON.stringify(logged)).not.toContain('smtp-pass');

    consoleSpy.mockRestore();
  });

  it('reflects the real dispatch outcome (ACCEPTED) in the returned result when the simulator succeeds', async () => {
    integration.dispatchExistingCommand.mockResolvedValue({ status: 'ACCEPTED' } as never);
    const { result } = await useCase.execute(baseInput());
    expect(result.commandStatus).toBe('ACCEPTED');
  });

  it('validates executives inside the transaction before assigning them (authoritative, ctx-bound)', async () => {
    await useCase.execute(baseInput({ primaryExecutiveId: 'exec_1', secondaryExecutiveIds: ['exec_2'] }));
    expect(executiveValidator.validate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, clientId: 'mc_1', primaryExecutiveId: 'exec_1', secondaryExecutiveIds: ['exec_2'] }),
      expect.anything(),
    );
  });

  it('never validates executives when none were provided', async () => {
    await useCase.execute(baseInput());
    expect(executiveValidator.validate).not.toHaveBeenCalled();
  });

  it('404s when an executive does not exist or belongs to a different organization', async () => {
    executiveValidator.validate.mockRejectedValue(new NotFoundException('Ejecutivo no encontrado.'));
    await expect(useCase.execute(baseInput({ primaryExecutiveId: 'exec_ghost' }))).rejects.toThrow(NotFoundException);
    expect(auditLogs.record).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('409s when an executive is inactive or not assigned to the client — never assigns, audits, or claims a command (real rollback of the whole transaction is proven at the Postgres integration level)', async () => {
    executiveValidator.validate.mockRejectedValue(new ConflictException('El ejecutivo no está asignado a este cliente.'));
    await expect(useCase.execute(baseInput({ primaryExecutiveId: 'exec_unassigned' }))).rejects.toThrow(ConflictException);
    expect(assignments.upsert).not.toHaveBeenCalled();
    expect(auditLogs.record).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(integration.dispatchExistingCommand).not.toHaveBeenCalled();
  });

  it('saves lastProvisionCommandId in the same transaction as the command claim (orphaned-command fix)', async () => {
    await useCase.execute(baseInput());
    expect(mailboxes.update).toHaveBeenCalledWith(
      'mailbox_1',
      expect.objectContaining({ lastProvisionCommandId: expect.any(String), provisioningStatus: 'PROVISION_REQUESTED' }),
      expect.anything(),
    );
  });

  it('advances the command to completion after dispatch and reflects it in the result (never stuck at PENDING when the engine completes)', async () => {
    const { result } = await useCase.execute(baseInput());
    expect(integration.advance).toHaveBeenCalledWith(orgId, expect.any(String), 'ALL', 'admin_1');
    expect(eventApplier.apply).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ id: 'mailbox_1' }),
      expect.objectContaining({ eventType: 'MAILBOX_PROVISION_COMPLETED' }),
      'admin_1',
    );
    expect(result.provisioningStatus).toBe('COMPLETED');
    expect(result.businessOperationConfirmed).toBe(true);
    expect(result.commandPersisted).toBe(true);
  });

  it('reflects a FAILED provisioning outcome without failing the request or losing the committed business operation', async () => {
    integration.advance.mockResolvedValue([{ eventType: 'MAILBOX_PROVISION_FAILED', commandId: 'cmd_1' }] as never);
    const { result, httpStatus } = await useCase.execute(baseInput());
    expect(httpStatus).toBe(201);
    expect(result.provisioningStatus).toBe('FAILED');
    expect(result.businessOperationConfirmed).toBe(true);
  });

  it('a failure in advance() (post-dispatch) still returns success, leaving provisioningStatus PENDING and never creating a second command', async () => {
    integration.advance.mockRejectedValue(new Error('advance blew up'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result.provisioningStatus).toBe('PENDING');
    expect(idempotency.claim).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('treats sanitized-to-empty signature HTML as no signature at all', async () => {
    htmlSanitizer.sanitize.mockReturnValue('   ');
    const { result } = await useCase.execute(baseInput({ signatureHtml: '<script>only()</script>' }));
    expect(signatures.create).not.toHaveBeenCalled();
    expect(result.signatureId).toBeNull();
  });
});
