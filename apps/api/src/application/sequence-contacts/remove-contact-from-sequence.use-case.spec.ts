import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import { RemoveContactFromSequenceInput, RemoveContactFromSequenceUseCase } from './remove-contact-from-sequence.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('RemoveContactFromSequenceUseCase', () => {
  let sequenceContacts: jest.Mocked<Pick<SequenceContactRepository, 'findById' | 'conditionalRemove'>>;
  let scheduledEmails: jest.Mocked<Pick<ScheduledEmailRepository, 'cancelFutureForSequenceContact'>>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'refreshResultSnapshot'>>;
  let integration: jest.Mocked<Pick<IntegrationService, 'dispatchExistingCommand' | 'advance'>>;
  let useCase: RemoveContactFromSequenceUseCase;

  const orgId = 'org_1';

  function baseInput(overrides: Partial<RemoveContactFromSequenceInput> = {}): RemoveContactFromSequenceInput {
    return {
      organizationId: orgId,
      sequenceId: 'seq_1',
      sequenceContactId: 'sc_1',
      reason: 'Solicitud del cliente',
      actorId: 'exec_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    sequenceContacts = {
      findById: jest.fn().mockResolvedValue({ id: 'sc_1', organizationId: orgId, sequenceId: 'seq_1', contactId: 'contact_1', status: 'ACTIVE' }),
      conditionalRemove: jest.fn().mockResolvedValue(1),
    };
    scheduledEmails = { cancelFutureForSequenceContact: jest.fn().mockResolvedValue(2) };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    idempotency = {
      checkExisting: jest.fn().mockResolvedValue(null),
      claim: jest.fn(),
      refreshResultSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    integration = {
      dispatchExistingCommand: jest.fn().mockImplementation(async (command) => ({ ...command, status: 'ACCEPTED' })),
      advance: jest.fn().mockResolvedValue([{ eventType: 'SEQUENCE_CONTACT_REMOVED', commandId: 'cmd_1' }]),
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

    useCase = new RemoveContactFromSequenceUseCase(
      new FakeTransactionManager(),
      sequenceContacts as unknown as SequenceContactRepository,
      scheduledEmails as unknown as ScheduledEmailRepository,
      auditLogs,
      idempotency as unknown as IdempotentOperationService,
      integration as unknown as IntegrationService,
    );
  });

  it('removes a contact end-to-end: claims, cancels future jobs, audits, claims a command', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(sequenceContacts.conditionalRemove).toHaveBeenCalledWith('sc_1', 'Solicitud del cliente', expect.anything());
    expect(scheduledEmails.cancelFutureForSequenceContact).toHaveBeenCalledWith('sc_1', 'Solicitud del cliente', expect.anything());
    expect(auditLogs.record).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('REMOVED');
    expect(result.cancelledJobs).toBe(2);
  });

  it('404s for a sequence contact in a different organization/sequence', async () => {
    sequenceContacts.findById.mockResolvedValue({ id: 'sc_1', organizationId: 'other_org', sequenceId: 'seq_1', contactId: 'contact_1', status: 'ACTIVE' } as never);
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('409s when the contact was already removed (claim fails)', async () => {
    sequenceContacts.conditionalRemove.mockResolvedValue(0);
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(auditLogs.record).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('idempotent retry with the same key and content returns the persisted result without re-claiming', async () => {
    const cached = { sequenceContactId: 'sc_1', sequenceId: 'seq_1', status: 'REMOVED', cancelledJobs: 2, commandId: 'cmd_x', commandStatus: 'ACCEPTED', correlationId: 'corr_1' };
    idempotency.checkExisting.mockResolvedValue({ resultSnapshot: cached, httpStatusCode: 201 } as never);

    const { result } = await useCase.execute(baseInput());
    expect(result).toEqual(cached);
    expect(sequenceContacts.conditionalRemove).not.toHaveBeenCalled();
  });

  it('409s when the same key is reused with a different reason (payload mismatch)', async () => {
    const { ConflictException: CE } = await import('@nestjs/common');
    idempotency.checkExisting.mockRejectedValue(new CE('mismatch'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('a dispatch failure still returns 201 with commandStatus left at REQUESTED', async () => {
    integration.dispatchExistingCommand.mockRejectedValue(new Error('engine unavailable'));
    const { result, httpStatus } = await useCase.execute(baseInput());
    expect(httpStatus).toBe(201);
    expect(result.commandStatus).toBe('REQUESTED');
  });
});
