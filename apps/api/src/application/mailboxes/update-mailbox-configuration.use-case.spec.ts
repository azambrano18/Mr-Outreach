import { ConflictException, NotFoundException } from '@nestjs/common';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ClientEligibilityService } from '../clients/client-eligibility.service';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import { ClientMailboxVisibilityService } from './client-mailbox-visibility.service';
import { MailboxExecutiveAssignmentValidator } from './mailbox-executive-assignment.validator';
import { MailboxProvisioningEventApplier } from './mailbox-provisioning-event-applier';
import { UpdateMailboxConfigurationInput, UpdateMailboxConfigurationUseCase } from './update-mailbox-configuration.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('UpdateMailboxConfigurationUseCase', () => {
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let signatures: jest.Mocked<SignatureRepository>;
  let signatureVersions: jest.Mocked<SignatureVersionRepository>;
  let managedClients: jest.Mocked<Pick<ManagedClientRepository, 'findById'>>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let eligibility: jest.Mocked<Pick<ClientEligibilityService, 'assertEligibleForPublish'>>;
  let secrets: jest.Mocked<Pick<SecretEncryptionService, 'encrypt' | 'decrypt'>>;
  let htmlSanitizer: jest.Mocked<Pick<HtmlSanitizerService, 'sanitize'>>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'refreshResultSnapshot'>>;
  let integration: jest.Mocked<Pick<IntegrationService, 'dispatchExistingCommand' | 'advance'>>;
  let executiveValidator: jest.Mocked<Pick<MailboxExecutiveAssignmentValidator, 'plan' | 'validate'>>;
  let eventApplier: jest.Mocked<Pick<MailboxProvisioningEventApplier, 'apply'>>;
  let clientVisibility: jest.Mocked<Pick<ClientMailboxVisibilityService, 'grantForExecutives' | 'revokeIfNoRemainingMailbox'>>;
  let useCase: UpdateMailboxConfigurationUseCase;

  const orgId = 'org_1';

  const baseMailbox = {
    id: 'mailbox_1',
    organizationId: orgId,
    clientId: 'mc_1',
    domainId: 'domain_1',
    name: 'Cuenta',
    email: 'ventas@ventas.cl',
    fromName: 'Ventas',
    replyTo: null,
    linkSource: 'LEGACY_LOCAL' as const,
    imap: { host: 'imap.old.cl', port: 993, encryption: 'SSL_TLS', username: 'old', verifyCertificate: true, secretCiphertext: 'enc(old-imap)' },
    smtp: { host: 'smtp.old.cl', port: 587, encryption: 'STARTTLS', username: 'old', verifyCertificate: true, secretCiphertext: 'enc(old-smtp)' },
  };

  function baseInput(overrides: Partial<UpdateMailboxConfigurationInput> = {}): UpdateMailboxConfigurationInput {
    return {
      organizationId: orgId,
      mailboxId: 'mailbox_1',
      actorId: 'admin_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    mailboxes = {
      findById: jest.fn().mockResolvedValue(baseMailbox),
      findByEmail: jest.fn(),
      findByServerMailboxId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      createLinked: jest.fn(),
      update: jest.fn().mockImplementation(async (_id, patch) => ({ ...baseMailbox, ...patch })),
    };
    assignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByMailbox: jest.fn().mockResolvedValue([]),
      findByUser: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
    };
    signatures = { findById: jest.fn(), findByMailbox: jest.fn().mockResolvedValue(null), findAllByOrganization: jest.fn(), create: jest.fn(), update: jest.fn() };
    signatureVersions = { create: jest.fn(), findById: jest.fn(), findBySignature: jest.fn() };
    managedClients = { findById: jest.fn().mockResolvedValue({ id: 'mc_1', organizationId: orgId, status: 'ACTIVE', externalStatusSnapshot: null }) };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    eligibility = { assertEligibleForPublish: jest.fn().mockResolvedValue(undefined) };
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

    idempotency.claim.mockImplementation(
      async (_ctx, input) =>
        ({
          id: 'row_1',
          organizationId: input.organizationId,
          commandId: input.commandId ?? 'cmd_fallback',
          commandType: input.commandType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          idempotencyKey: `${input.scope}:${input.rawIdempotencyKey}`,
          correlationId: input.correlationId,
          payload: input.commandPayload,
          status: 'REQUESTED',
          requestedBy: input.requestedBy,
          createdAt: new Date(),
          payloadHash: input.payloadHash,
          resultSnapshot: null,
          httpStatusCode: null,
        }) as never,
    );

    useCase = new UpdateMailboxConfigurationUseCase(
      new FakeTransactionManager(),
      mailboxes,
      assignments,
      signatures,
      signatureVersions,
      managedClients as unknown as ManagedClientRepository,
      auditLogs,
      eligibility as unknown as ClientEligibilityService,
      secrets as unknown as SecretEncryptionService,
      htmlSanitizer as unknown as HtmlSanitizerService,
      idempotency as unknown as IdempotentOperationService,
      integration as unknown as IntegrationService,
      executiveValidator as unknown as MailboxExecutiveAssignmentValidator,
      eventApplier as unknown as MailboxProvisioningEventApplier,
      clientVisibility as never,
    );
  });

  it('updates a descriptive field end-to-end, claims a command, dispatches+advances after commit', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput({ fromName: 'Nuevo Nombre' }));
    expect(httpStatus).toBe(201);
    expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', expect.objectContaining({ fromName: 'Nuevo Nombre' }), expect.anything());
    expect(idempotency.claim).toHaveBeenCalledTimes(1);
    expect(integration.dispatchExistingCommand).toHaveBeenCalledTimes(1);
    expect(integration.advance).toHaveBeenCalledTimes(1);
    expect(result.provisioningStatus).toBe('COMPLETED');
  });

  it('404s for a mailbox in a different organization', async () => {
    mailboxes.findById.mockResolvedValue({ ...baseMailbox, organizationId: 'other_org' } as never);
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('404s for a mailbox that does not exist', async () => {
    mailboxes.findById.mockResolvedValue(null as never);
    await expect(useCase.execute(baseInput({ imap: { host: 'imap.new.cl' } }))).rejects.toThrow(NotFoundException);
  });

  describe('manual IMAP/SMTP configuration guard (server-linked accounts)', () => {
    it('rejects an imap patch for a SERVER_TOKEN mailbox and modifies nothing', async () => {
      mailboxes.findById.mockResolvedValue({ ...baseMailbox, linkSource: 'SERVER_TOKEN' } as never);
      await expect(useCase.execute(baseInput({ imap: { host: 'imap.new.cl' } }))).rejects.toThrow(ConflictException);
      expect(mailboxes.update).not.toHaveBeenCalled();
      expect(idempotency.claim).not.toHaveBeenCalled();
      expect(auditLogs.record).not.toHaveBeenCalled();
    });

    it('rejects an smtp patch for a SERVER_TOKEN mailbox and modifies nothing', async () => {
      mailboxes.findById.mockResolvedValue({ ...baseMailbox, linkSource: 'SERVER_TOKEN' } as never);
      await expect(
        useCase.execute(baseInput({ smtp: { host: 'smtp.new.cl' } })),
      ).rejects.toThrow('Esta cuenta es administrada por el servidor y no admite configuración IMAP/SMTP desde Mr Outreach.');
      expect(mailboxes.update).not.toHaveBeenCalled();
    });

    it('rejects an imap/smtp patch for an unknown/unexpected linkSource by default (fail-closed)', async () => {
      mailboxes.findById.mockResolvedValue({ ...baseMailbox, linkSource: 'SOMETHING_UNEXPECTED' } as never);
      await expect(useCase.execute(baseInput({ imap: { host: 'imap.new.cl' } }))).rejects.toThrow(ConflictException);
      expect(mailboxes.update).not.toHaveBeenCalled();
    });

    it('allows an imap/smtp patch for a LEGACY_LOCAL mailbox (existing behavior preserved)', async () => {
      await expect(
        useCase.execute(baseInput({ imap: { host: 'imap.new.cl' }, smtp: { host: 'smtp.new.cl' } })),
      ).resolves.toEqual(expect.objectContaining({ httpStatus: 201 }));
      expect(mailboxes.update).toHaveBeenCalled();
    });

    it('does not reject a SERVER_TOKEN mailbox update that never touches imap/smtp (e.g. only fromName)', async () => {
      mailboxes.findById.mockResolvedValue({ ...baseMailbox, linkSource: 'SERVER_TOKEN' } as never);
      await expect(useCase.execute(baseInput({ fromName: 'Nuevo Nombre' }))).resolves.toEqual(
        expect.objectContaining({ httpStatus: 201 }),
      );
    });

    it('enforces multi-tenant isolation together with the guard: a SERVER_TOKEN mailbox from another org 404s before the guard even runs', async () => {
      mailboxes.findById.mockResolvedValue({ ...baseMailbox, linkSource: 'SERVER_TOKEN', organizationId: 'other_org' } as never);
      await expect(useCase.execute(baseInput({ imap: { host: 'imap.new.cl' } }))).rejects.toThrow(NotFoundException);
    });
  });

  it('an omitted password never touches the stored ciphertext', async () => {
    await useCase.execute(baseInput({ imap: { host: 'imap.new.cl' } }));
    const patchArg = mailboxes.update.mock.calls[0][1] as { imap: Record<string, unknown> };
    expect(patchArg.imap).not.toHaveProperty('secretCiphertext');
    expect(secrets.encrypt).not.toHaveBeenCalled();
  });

  it('a new password is encrypted and replaces the stored ciphertext', async () => {
    await useCase.execute(baseInput({ imap: { host: 'imap.new.cl', password: 'new-secret' } }));
    expect(secrets.encrypt).toHaveBeenCalledWith('new-secret');
    const patchArg = mailboxes.update.mock.calls[0][1] as { imap: Record<string, unknown> };
    expect(patchArg.imap.secretCiphertext).toBe('enc(new-secret)');
  });

  it('never persists a plaintext password anywhere in the command payload or audit metadata', async () => {
    await useCase.execute(baseInput({ imap: { host: 'imap.new.cl', password: 'super-secret-pw' } }));
    const claimCall = idempotency.claim.mock.calls[0][1];
    expect(JSON.stringify(claimCall.commandPayload)).not.toContain('super-secret-pw');
    expect(JSON.stringify(auditLogs.record.mock.calls[0][0])).not.toContain('super-secret-pw');
  });

  it('signature omitted (key absent) leaves the existing signature untouched', async () => {
    signatures.findByMailbox.mockResolvedValue({ id: 'sig_1', organizationId: orgId, mailboxId: 'mailbox_1', status: 'ACTIVE', activeVersionId: 'v1' } as never);
    const { result } = await useCase.execute(baseInput({ fromName: 'Solo esto cambia' }));
    expect(signatures.update).not.toHaveBeenCalled();
    expect(signatureVersions.create).not.toHaveBeenCalled();
    expect(result.signatureId).toBe('sig_1');
  });

  it('signature provided with content creates a new version and activates it', async () => {
    signatures.findByMailbox.mockResolvedValue(null);
    signatures.create.mockResolvedValue({ id: 'sig_new', organizationId: orgId, mailboxId: 'mailbox_1', status: 'ACTIVE', activeVersionId: null } as never);
    signatureVersions.create.mockResolvedValue({ id: 'ver_1', signatureId: 'sig_new', versionNumber: 1 } as never);

    const { result } = await useCase.execute(baseInput({ signatureHtml: '<p>Hola</p>' }));

    expect(signatureVersions.create).toHaveBeenCalledTimes(1);
    expect(signatures.update).toHaveBeenCalledWith('sig_new', { activeVersionId: 'ver_1', status: 'ACTIVE' }, expect.anything());
    expect(result.signatureId).toBe('sig_new');
  });

  it('signature explicitly sent empty (normalizes to nothing) archives the existing signature — never a hard delete', async () => {
    signatures.findByMailbox.mockResolvedValue({ id: 'sig_1', organizationId: orgId, mailboxId: 'mailbox_1', status: 'ACTIVE', activeVersionId: 'v1' } as never);
    htmlSanitizer.sanitize.mockReturnValue('');

    await useCase.execute(baseInput({ signatureHtml: '' }));

    expect(signatures.update).toHaveBeenCalledWith('sig_1', { status: 'ARCHIVED' }, expect.anything());
    expect(signatureVersions.create).not.toHaveBeenCalled();
  });

  it('executives omitted (both fields absent) leaves existing assignments untouched', async () => {
    await useCase.execute(baseInput({ fromName: 'Solo esto' }));
    expect(assignments.findByMailbox).not.toHaveBeenCalled();
    expect(assignments.upsert).not.toHaveBeenCalled();
    expect(assignments.remove).not.toHaveBeenCalled();
  });

  it('changing assignments replaces them: removes ones no longer wanted, upserts the new plan', async () => {
    assignments.findByMailbox.mockResolvedValue([
      { id: 'a1', organizationId: orgId, mailboxId: 'mailbox_1', userId: 'exec_old', role: 'PRIMARY', assignedBy: 'admin_1', assignedAt: new Date() },
    ]);

    await useCase.execute(baseInput({ primaryExecutiveId: 'exec_new', secondaryExecutiveIds: ['exec_2'] }));

    expect(assignments.remove).toHaveBeenCalledWith('mailbox_1', 'exec_old', expect.anything());
    expect(assignments.upsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'exec_new', role: 'PRIMARY' }), expect.anything());
    expect(assignments.upsert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'exec_2', role: 'SECONDARY' }), expect.anything());
  });

  it('§10 — grants derived visibility to the kept executives and revoke-checks the removed one', async () => {
    assignments.findByMailbox.mockResolvedValue([
      { id: 'a1', organizationId: orgId, mailboxId: 'mailbox_1', userId: 'exec_old', role: 'PRIMARY', assignedBy: 'admin_1', assignedAt: new Date() },
    ]);

    await useCase.execute(baseInput({ primaryExecutiveId: 'exec_new', secondaryExecutiveIds: ['exec_2'] }));

    expect(clientVisibility.grantForExecutives).toHaveBeenCalledWith(orgId, 'mc_1', expect.arrayContaining(['exec_new', 'exec_2']), 'admin_1', expect.anything());
    expect(clientVisibility.revokeIfNoRemainingMailbox).toHaveBeenCalledWith(orgId, 'mc_1', 'exec_old', expect.anything());
  });

  it('an explicitly empty executive list removes every assignment', async () => {
    assignments.findByMailbox.mockResolvedValue([
      { id: 'a1', organizationId: orgId, mailboxId: 'mailbox_1', userId: 'exec_old', role: 'PRIMARY', assignedBy: 'admin_1', assignedAt: new Date() },
    ]);
    await useCase.execute(baseInput({ primaryExecutiveId: null, secondaryExecutiveIds: [] }));
    expect(assignments.remove).toHaveBeenCalledWith('mailbox_1', 'exec_old', expect.anything());
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('validates executives inside the transaction (authoritative)', async () => {
    await useCase.execute(baseInput({ primaryExecutiveId: 'exec_1' }));
    expect(executiveValidator.validate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, clientId: 'mc_1', primaryExecutiveId: 'exec_1' }),
      expect.anything(),
    );
  });

  it('404s for an invalid executive', async () => {
    executiveValidator.validate.mockRejectedValue(new NotFoundException('Ejecutivo no encontrado.'));
    await expect(useCase.execute(baseInput({ primaryExecutiveId: 'ghost' }))).rejects.toThrow(NotFoundException);
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('rolls back completely (no assignment, no audit, no claim) when an intermediate step fails', async () => {
    signatures.create.mockRejectedValue(new Error('db exploded'));
    await expect(useCase.execute(baseInput({ signatureHtml: '<p>x</p>', primaryExecutiveId: 'exec_1' }))).rejects.toThrow('db exploded');
    expect(assignments.upsert).not.toHaveBeenCalled();
    expect(auditLogs.record).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('saves lastProvisionCommandId in the same transaction as the command claim', async () => {
    await useCase.execute(baseInput());
    expect(mailboxes.update).toHaveBeenCalledWith(
      'mailbox_1',
      expect.objectContaining({ lastProvisionCommandId: expect.any(String), provisioningStatus: 'PROVISION_REQUESTED' }),
      expect.anything(),
    );
  });

  it('idempotent retry with the same key and payload returns the persisted result without repeating any write', async () => {
    const cached = {
      mailboxId: 'mailbox_1', signatureId: null, primaryExecutiveId: null, secondaryExecutiveIds: [],
      commandId: 'cmd_prev', commandStatus: 'ACCEPTED', correlationId: 'corr_prev',
      businessOperationConfirmed: true, commandPersisted: true, provisioningStatus: 'COMPLETED',
    };
    idempotency.checkExisting.mockResolvedValue({ resultSnapshot: cached, httpStatusCode: 201 } as never);

    const { result } = await useCase.execute(baseInput());
    expect(result).toEqual(cached);
    expect(mailboxes.update).not.toHaveBeenCalled();
  });

  it('409s when the same key is reused with a different payload', async () => {
    idempotency.checkExisting.mockRejectedValue(new ConflictException('mismatch'));
    await expect(useCase.execute(baseInput({ fromName: 'X' }))).rejects.toThrow(ConflictException);
  });

  it('a FAILED provisioning outcome is reflected without failing the request', async () => {
    integration.advance.mockResolvedValue([{ eventType: 'MAILBOX_PROVISION_FAILED', commandId: 'cmd_1' }] as never);
    const { result, httpStatus } = await useCase.execute(baseInput());
    expect(httpStatus).toBe(201);
    expect(result.provisioningStatus).toBe('FAILED');
  });

  it('a post-commit simulator failure still returns success, never creating a second command', async () => {
    integration.dispatchExistingCommand.mockRejectedValue(new Error('engine down'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result.commandStatus).toBe('REQUESTED');
    expect(result.provisioningStatus).toBe('PENDING');
    expect(idempotency.claim).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
