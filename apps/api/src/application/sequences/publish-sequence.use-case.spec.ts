import { ConflictException, NotFoundException } from '@nestjs/common';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SequenceStepVersionRepository } from '../../domain/sequence/sequence-step-version.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { SimulatedMailEngineAdapter } from '../../infrastructure/mail-engine/simulated/simulated-mail-engine-adapter';
import { ClientEligibilityService } from '../clients/client-eligibility.service';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import { PublishSequenceInput, PublishSequenceUseCase } from './publish-sequence.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('PublishSequenceUseCase', () => {
  let sequences: jest.Mocked<SequenceRepository>;
  let steps: jest.Mocked<SequenceStepRepository>;
  let stepVersions: jest.Mocked<SequenceStepVersionRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let signatures: jest.Mocked<SignatureRepository>;
  let signatureVersions: jest.Mocked<SignatureVersionRepository>;
  let sequenceContacts: jest.Mocked<SequenceContactRepository>;
  let contacts: jest.Mocked<Pick<ContactRepository, 'findManyByIds'>>;
  let companies: jest.Mocked<Pick<CompanyRepository, 'findManyByIds'>>;
  let managedClients: jest.Mocked<Pick<ManagedClientRepository, 'findById'>>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let eligibility: jest.Mocked<Pick<ClientEligibilityService, 'assertEligibleForPublish'>>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'refreshResultSnapshot'>>;
  let integration: jest.Mocked<Pick<IntegrationService, 'dispatchExistingCommand' | 'advance'>>;
  let simulatedAdapter: jest.Mocked<Pick<SimulatedMailEngineAdapter, 'setPublishScenario'>>;
  let motor: jest.Mocked<MailboxMotorPort>;
  let useCase: PublishSequenceUseCase;

  const orgId = 'org_1';

  function baseInput(overrides: Partial<PublishSequenceInput> = {}): PublishSequenceInput {
    return {
      organizationId: orgId,
      sequenceId: 'seq_1',
      actorId: 'exec_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  function buildSequence(overrides: Record<string, unknown> = {}) {
    return {
      id: 'seq_1',
      organizationId: orgId,
      executiveId: 'exec_1',
      mailboxId: 'mailbox_1',
      clientId: null,
      name: 'Secuencia',
      managementDate: null,
      timezone: 'America/Santiago',
      schedule: { days: ['MON'], windows: [{ start: '09:00', end: '18:00' }] },
      policies: { stopOnReply: true, stopOnHardBounce: true, stopOnUnsubscribe: true, prioritizeFollowUps: true },
      publishStatus: null,
      sequenceVersion: 0,
      effectiveStartAt: null,
      lastPublishedAt: null,
      lastPublishCommandId: null,
      ...overrides,
    } as never;
  }

  function buildStep(overrides: Record<string, unknown> = {}) {
    return {
      id: 'step_1',
      name: 'Enviados_1',
      position: 1,
      status: 'PUBLISHED',
      subject: 'Hola',
      htmlHeader: null,
      htmlBody: '<p>Hola</p>',
      plainTextBody: 'Hola',
      delayValue: 0,
      delayUnit: 'DAYS',
      ...overrides,
    } as never;
  }

  beforeEach(() => {
    sequences = {
      findById: jest.fn().mockResolvedValue(buildSequence()),
      findByExecutive: jest.fn(),
      findByClient: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockImplementation(async (_id, patch) => buildSequence(patch)),
      conditionalUpdatePublishStatus: jest.fn().mockResolvedValue(1),
    };
    steps = {
      findById: jest.fn(),
      findBySequence: jest.fn().mockResolvedValue([buildStep()]),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    stepVersions = { create: jest.fn(), findByStep: jest.fn().mockResolvedValue([{ versionNumber: 1 }]) } as never;
    mailboxes = {
      findById: jest.fn().mockResolvedValue({ id: 'mailbox_1', organizationId: orgId, clientId: null, domainId: null }),
      findByEmail: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as never;
    signatures = { findById: jest.fn(), findByMailbox: jest.fn().mockResolvedValue(null), findAllByOrganization: jest.fn(), create: jest.fn(), update: jest.fn() };
    signatureVersions = { create: jest.fn(), findById: jest.fn(), findBySignature: jest.fn() };
    sequenceContacts = {
      findById: jest.fn(),
      findBySequence: jest.fn().mockResolvedValue([]),
      findByContactAndSequence: jest.fn(),
      findByContact: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
      bulkSetScheduled: jest.fn(),
      conditionalRemove: jest.fn(),
      bulkRemoveByCompany: jest.fn(),
    };
    contacts = { findManyByIds: jest.fn().mockResolvedValue([]) };
    companies = { findManyByIds: jest.fn().mockResolvedValue([]) };
    managedClients = { findById: jest.fn().mockResolvedValue({ id: 'mc_1', organizationId: orgId, status: 'ACTIVE', externalStatusSnapshot: null }) };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    eligibility = { assertEligibleForPublish: jest.fn().mockResolvedValue(undefined) };
    idempotency = {
      checkExisting: jest.fn().mockResolvedValue(null),
      claim: jest.fn(),
      refreshResultSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    integration = {
      dispatchExistingCommand: jest.fn().mockImplementation(async (command) => ({ ...command, status: 'ACCEPTED' })),
      advance: jest.fn().mockResolvedValue([
        { eventType: 'SEQUENCE_PUBLISH_ACCEPTED', commandId: 'cmd_1' },
        { eventType: 'SEQUENCE_PUBLISH_COMPLETED', commandId: 'cmd_1' },
      ]),
    };
    simulatedAdapter = { setPublishScenario: jest.fn() };
    motor = {
      introspectLinkToken: jest.fn(),
      redeemLinkToken: jest.fn(),
      getMailboxStatus: jest.fn(),
      unlinkMailbox: jest.fn(),
    };

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

    useCase = new PublishSequenceUseCase(
      new FakeTransactionManager(),
      sequences,
      steps,
      stepVersions,
      mailboxes,
      signatures,
      signatureVersions,
      sequenceContacts,
      contacts as unknown as ContactRepository,
      companies as unknown as CompanyRepository,
      managedClients as unknown as ManagedClientRepository,
      auditLogs,
      eligibility as unknown as ClientEligibilityService,
      idempotency as unknown as IdempotentOperationService,
      integration as unknown as IntegrationService,
      simulatedAdapter as unknown as SimulatedMailEngineAdapter,
      motor,
    );
  });

  it('publishes end-to-end: claims, commits, dispatches, and reaches ACTIVE with sequenceVersion bumped', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(sequences.conditionalUpdatePublishStatus).toHaveBeenCalledWith(
      'seq_1',
      ['REQUESTED', 'ACCEPTED', 'PROCESSING', 'SCHEDULED'],
      'REQUESTED',
      expect.anything(),
    );
    expect(idempotency.claim).toHaveBeenCalledTimes(1);
    expect(integration.dispatchExistingCommand).toHaveBeenCalledTimes(1);
    expect(integration.advance).toHaveBeenCalledTimes(1);
    expect(result.publishStatus).toBe('ACTIVE');
    expect(result.sequenceVersion).toBe(1);
    expect(result.lastPublishedAt).not.toBeNull();
    expect(result.effectiveStartAt).not.toBeNull();
    expect(idempotency.refreshResultSnapshot).toHaveBeenCalledTimes(1);
  });

  it('404s for a sequence in a different organization', async () => {
    sequences.findById.mockResolvedValue(buildSequence({ organizationId: 'other_org' }));
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('rejects a sequence with no sender mailbox (409)', async () => {
    sequences.findById.mockResolvedValue(buildSequence({ mailboxId: null }));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('404s when the sender mailbox no longer exists', async () => {
    mailboxes.findById.mockResolvedValue(null);
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('rejects a sequence with no active step (409)', async () => {
    steps.findBySequence.mockResolvedValue([]);
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('checks client eligibility when the mailbox is linked to a client, and propagates a 409', async () => {
    const { ConflictException: CE } = await import('@nestjs/common');
    (mailboxes.findById as jest.Mock).mockResolvedValue({ id: 'mailbox_1', organizationId: orgId, clientId: 'mc_1', domainId: 'domain_1' });
    eligibility.assertEligibleForPublish.mockRejectedValue(new CE('inactive'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(sequences.conditionalUpdatePublishStatus).not.toHaveBeenCalled();
  });

  it('never checks eligibility when the sender mailbox has no clientId (Pendiente de clasificación)', async () => {
    await useCase.execute(baseInput());
    expect(eligibility.assertEligibleForPublish).not.toHaveBeenCalled();
  });

  it('idempotent retry with the same key and content returns the persisted result without re-claiming', async () => {
    const cachedResult = { sequenceId: 'seq_1', publishStatus: 'ACTIVE', sequenceVersion: 1, commandId: 'cmd_x', commandStatus: 'ACCEPTED', correlationId: 'corr_1', effectiveStartAt: null, lastPublishedAt: null };
    idempotency.checkExisting.mockResolvedValue({ resultSnapshot: cachedResult, httpStatusCode: 201 } as never);

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result).toEqual(cachedResult);
    expect(sequences.conditionalUpdatePublishStatus).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('409s when the same key is reused with different content (payload mismatch)', async () => {
    const { ConflictException: CE } = await import('@nestjs/common');
    idempotency.checkExisting.mockRejectedValue(new CE('mismatch'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('409s when a publish is already in flight for this sequence (concurrent claim loss), recovering the winner\'s cached result if found', async () => {
    sequences.conditionalUpdatePublishStatus.mockResolvedValue(0);
    idempotency.checkExisting.mockResolvedValueOnce(null); // pre-tx check: no prior result yet
    const winnerResult = { sequenceId: 'seq_1', publishStatus: 'REQUESTED', sequenceVersion: 0, commandId: 'cmd_winner', commandStatus: 'REQUESTED', correlationId: 'corr_1', effectiveStartAt: null, lastPublishedAt: null };
    idempotency.checkExisting.mockResolvedValueOnce({ resultSnapshot: winnerResult, httpStatusCode: 201 } as never);

    const { result } = await useCase.execute(baseInput());
    expect(result).toEqual(winnerResult);
  });

  it('a FAILED scenario leaves sequenceVersion/lastPublishedAt untouched, but records publishStatus FAILED', async () => {
    integration.advance.mockResolvedValue([{ eventType: 'SEQUENCE_PUBLISH_FAILED', commandId: 'cmd_1' }] as never);

    const { result } = await useCase.execute(baseInput({ scenario: 'FAILED' }));

    expect(simulatedAdapter.setPublishScenario).toHaveBeenCalledWith(expect.any(String), 'FAILED');
    expect(result.publishStatus).toBe('FAILED');
    expect(result.sequenceVersion).toBe(0);
    expect(result.lastPublishedAt).toBeNull();
    expect(result.effectiveStartAt).toBeNull();
  });

  it('a dispatch failure still returns 201 with commandStatus left at REQUESTED (business already committed)', async () => {
    integration.dispatchExistingCommand.mockRejectedValue(new Error('engine unavailable'));
    const { result, httpStatus } = await useCase.execute(baseInput());
    expect(httpStatus).toBe(201);
    expect(result.commandStatus).toBe('REQUESTED');
    expect(result.publishStatus).toBe('REQUESTED');
  });

  it('never writes any state before conditionalUpdatePublishStatus succeeds — pure reads only up to that point', async () => {
    sequences.conditionalUpdatePublishStatus.mockResolvedValue(0);
    idempotency.checkExisting.mockResolvedValue(null);
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(sequences.update).not.toHaveBeenCalled();
    expect(auditLogs.record).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  describe('Fase 2.1 — fail-closed publish eligibility for SERVER_TOKEN mailboxes', () => {
    function serverMailbox(overrides: Record<string, unknown> = {}) {
      return {
        id: 'mailbox_1',
        organizationId: orgId,
        clientId: null,
        domainId: null,
        status: 'ACTIVE',
        linkSource: 'SERVER_TOKEN',
        serverMailboxId: 'mbx_1',
        ...overrides,
      };
    }

    beforeEach(() => {
      motor.getMailboxStatus.mockResolvedValue({
        serverMailboxId: 'mbx_1',
        linkStatus: 'ACTIVE',
        technicalStatus: 'CONNECTED',
        canSend: true,
        checkedAt: new Date(),
      });
    });

    it('queries the motor live before publishing and refreshes the local snapshot', async () => {
      (mailboxes.findById as jest.Mock).mockResolvedValue(serverMailbox());

      await useCase.execute(baseInput());

      expect(motor.getMailboxStatus).toHaveBeenCalledWith('mbx_1');
      expect(mailboxes.update).toHaveBeenCalledWith(
        'mailbox_1',
        expect.objectContaining({ linkStatus: 'ACTIVE', serverStatusSnapshot: 'CONNECTED', serverCanSendSnapshot: true }),
      );
    });

    it('blocks publishing (409) when the motor reports the link REVOKED, and refreshes the snapshot to match', async () => {
      (mailboxes.findById as jest.Mock).mockResolvedValue(serverMailbox());
      motor.getMailboxStatus.mockResolvedValue({
        serverMailboxId: 'mbx_1',
        linkStatus: 'REVOKED',
        technicalStatus: 'DISCONNECTED',
        canSend: false,
        checkedAt: new Date(),
      });

      await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
      expect(mailboxes.update).toHaveBeenCalledWith('mailbox_1', expect.objectContaining({ linkStatus: 'REVOKED' }));
      expect(sequences.conditionalUpdatePublishStatus).not.toHaveBeenCalled();
    });

    it('blocks publishing (409) when the account cannot currently send', async () => {
      (mailboxes.findById as jest.Mock).mockResolvedValue(serverMailbox());
      motor.getMailboxStatus.mockResolvedValue({
        serverMailboxId: 'mbx_1',
        linkStatus: 'ACTIVE',
        technicalStatus: 'DEGRADED',
        canSend: false,
        checkedAt: new Date(),
      });

      await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
      expect(sequences.conditionalUpdatePublishStatus).not.toHaveBeenCalled();
    });

    it('fails closed (503) when the motor is unavailable — never publishes, never uses a stale snapshot', async () => {
      const { ServiceUnavailableException } = await import('@nestjs/common');
      (mailboxes.findById as jest.Mock).mockResolvedValue(serverMailbox());
      motor.getMailboxStatus.mockRejectedValue(new ServiceUnavailableException('motor caído'));

      await expect(useCase.execute(baseInput())).rejects.toThrow(ServiceUnavailableException);
      expect(sequences.conditionalUpdatePublishStatus).not.toHaveBeenCalled();
      expect(idempotency.claim).not.toHaveBeenCalled();
    });

    it('never touches the motor for a LEGACY_LOCAL mailbox', async () => {
      (mailboxes.findById as jest.Mock).mockResolvedValue({ id: 'mailbox_1', organizationId: orgId, clientId: null, domainId: null, linkSource: 'LEGACY_LOCAL' });

      await useCase.execute(baseInput());

      expect(motor.getMailboxStatus).not.toHaveBeenCalled();
    });
  });
});
