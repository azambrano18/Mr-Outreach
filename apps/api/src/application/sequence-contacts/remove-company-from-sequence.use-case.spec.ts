import { NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import { RemoveCompanyFromSequenceInput, RemoveCompanyFromSequenceUseCase } from './remove-company-from-sequence.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('RemoveCompanyFromSequenceUseCase', () => {
  let sequenceContacts: jest.Mocked<Pick<SequenceContactRepository, 'bulkRemoveByCompany'>>;
  let scheduledEmails: jest.Mocked<Pick<ScheduledEmailRepository, 'cancelFutureForSequenceCompany'>>;
  let companies: jest.Mocked<Pick<CompanyRepository, 'findById'>>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'refreshResultSnapshot'>>;
  let integration: jest.Mocked<Pick<IntegrationService, 'dispatchExistingCommand' | 'advance'>>;
  let useCase: RemoveCompanyFromSequenceUseCase;

  const orgId = 'org_1';

  function baseInput(overrides: Partial<RemoveCompanyFromSequenceInput> = {}): RemoveCompanyFromSequenceInput {
    return {
      organizationId: orgId,
      sequenceId: 'seq_1',
      companyId: 'company_1',
      reason: 'Empresa dada de baja',
      actorId: 'exec_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    companies = { findById: jest.fn().mockResolvedValue({ id: 'company_1', organizationId: orgId }) };
    sequenceContacts = { bulkRemoveByCompany: jest.fn().mockResolvedValue(3) };
    scheduledEmails = { cancelFutureForSequenceCompany: jest.fn().mockResolvedValue(5) };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    idempotency = {
      checkExisting: jest.fn().mockResolvedValue(null),
      claim: jest.fn(),
      refreshResultSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    integration = {
      dispatchExistingCommand: jest.fn().mockImplementation(async (command) => ({ ...command, status: 'ACCEPTED' })),
      advance: jest.fn().mockResolvedValue([{ eventType: 'SEQUENCE_COMPANY_REMOVED', commandId: 'cmd_1' }]),
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

    useCase = new RemoveCompanyFromSequenceUseCase(
      new FakeTransactionManager(),
      sequenceContacts as unknown as SequenceContactRepository,
      scheduledEmails as unknown as ScheduledEmailRepository,
      companies as unknown as CompanyRepository,
      auditLogs,
      idempotency as unknown as IdempotentOperationService,
      integration as unknown as IntegrationService,
    );
  });

  it('removes every contact of a company within one sequence end-to-end, in bulk', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(sequenceContacts.bulkRemoveByCompany).toHaveBeenCalledWith(orgId, 'seq_1', 'company_1', 'Empresa dada de baja', expect.anything());
    expect(scheduledEmails.cancelFutureForSequenceCompany).toHaveBeenCalledWith('seq_1', 'company_1', 'Empresa dada de baja', expect.anything());
    expect(result.affectedContacts).toBe(3);
    expect(result.cancelledJobs).toBe(5);
  });

  it('404s for a company in a different organization', async () => {
    companies.findById.mockResolvedValue({ id: 'company_1', organizationId: 'other_org' } as never);
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('is a no-op success (0 affected) when every contact is already removed — never an error', async () => {
    sequenceContacts.bulkRemoveByCompany.mockResolvedValue(0);
    scheduledEmails.cancelFutureForSequenceCompany.mockResolvedValue(0);
    const { result, httpStatus } = await useCase.execute(baseInput());
    expect(httpStatus).toBe(201);
    expect(result.affectedContacts).toBe(0);
  });

  it('idempotent retry with the same key and content returns the persisted result without re-executing', async () => {
    const cached = { companyId: 'company_1', sequenceId: 'seq_1', affectedContacts: 3, cancelledJobs: 5, commandId: 'cmd_x', commandStatus: 'ACCEPTED', correlationId: 'corr_1' };
    idempotency.checkExisting.mockResolvedValue({ resultSnapshot: cached, httpStatusCode: 201 } as never);

    const { result } = await useCase.execute(baseInput());
    expect(result).toEqual(cached);
    expect(sequenceContacts.bulkRemoveByCompany).not.toHaveBeenCalled();
  });

  it('a dispatch failure still returns 201 with commandStatus left at REQUESTED', async () => {
    integration.dispatchExistingCommand.mockRejectedValue(new Error('engine unavailable'));
    const { result, httpStatus } = await useCase.execute(baseInput());
    expect(httpStatus).toBe(201);
    expect(result.commandStatus).toBe('REQUESTED');
  });
});
