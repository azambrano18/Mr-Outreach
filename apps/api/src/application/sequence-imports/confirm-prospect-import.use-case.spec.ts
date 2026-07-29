import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceImportRow } from '../../domain/sequence-import-row/sequence-import-row.entity';
import { SequenceImportRowRepository } from '../../domain/sequence-import-row/sequence-import-row.repository';
import { SequenceImportRepository } from '../../domain/sequence-import/sequence-import.repository';
import { CrmClientEligibilityService } from '../crm-clients/crm-client-eligibility.service';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import {
  ConfirmProspectImportInput,
  ConfirmProspectImportUseCase,
  MAX_IMPORT_ROWS,
} from './confirm-prospect-import.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('ConfirmProspectImportUseCase', () => {
  let imports: jest.Mocked<SequenceImportRepository>;
  let importRows: jest.Mocked<SequenceImportRowRepository>;
  let companies: jest.Mocked<CompanyRepository>;
  let contacts: jest.Mocked<ContactRepository>;
  let sequenceContacts: jest.Mocked<SequenceContactRepository>;
  let sequences: jest.Mocked<SequenceRepository>;
  let steps: jest.Mocked<SequenceStepRepository>;
  let managedClients: jest.Mocked<ManagedClientRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let crmEligibility: jest.Mocked<Pick<CrmClientEligibilityService, 'getVerifiedActiveClient'>>;
  let idempotency: jest.Mocked<Pick<IdempotentOperationService, 'checkExisting' | 'claim' | 'refreshResultSnapshot'>>;
  let integration: jest.Mocked<Pick<IntegrationService, 'dispatchExistingCommand'>>;
  let useCase: ConfirmProspectImportUseCase;

  const orgId = 'org_1';

  function buildImportRow(overrides: Partial<SequenceImportRow> = {}, index = 1): SequenceImportRow {
    return {
      id: `row_${index}`,
      organizationId: orgId,
      importId: 'import_1',
      rowNumber: index,
      rawData: { email: `contacto${index}@empresa.cl`, empresa: 'Empresa Uno', ciudad: 'Santiago' },
      normalizedData: {
        email: `contacto${index}@empresa.cl`,
        firstName: 'Nombre',
        lastName: null,
        fullName: null,
        companyRawName: 'Empresa Uno',
        jobTitle: null,
        phone: null,
        city: null,
        country: null,
        website: null,
        linkedin: null,
      },
      companyRawName: 'Empresa Uno',
      email: `contacto${index}@empresa.cl`,
      validationStatus: 'VALID',
      validationErrors: [],
      isDuplicate: false,
      rejectionReason: null,
      contactId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function baseInput(overrides: Partial<ConfirmProspectImportInput> = {}): ConfirmProspectImportInput {
    return {
      organizationId: orgId,
      importId: 'import_1',
      sequenceId: 'seq_1',
      actorId: 'admin_1',
      idempotencyKey: 'client-key-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    imports = {
      findById: jest.fn(),
      findBySequence: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      conditionalUpdateStatus: jest.fn().mockResolvedValue(1),
    };
    importRows = {
      findById: jest.fn(),
      findByImport: jest.fn(),
      replaceForImport: jest.fn(),
      update: jest.fn(),
      bulkSetContactAndNormalizedData: jest.fn().mockResolvedValue(undefined),
    };
    companies = {
      findById: jest.fn(),
      findByNormalizedName: jest.fn(),
      findByClient: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findManyByNormalizedNames: jest.fn().mockResolvedValue([]),
      findManyByIds: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockImplementation(async (inputs) =>
        inputs.map((i: { id: string; rawName: string }) => ({
          id: i.id,
          organizationId: orgId,
          clientId: 'mc_1',
          rawName: i.rawName,
          normalizedName: i.rawName.toLowerCase(),
          suppressed: false,
          suppressedAt: null,
          suppressedReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        })),
      ),
    };
    contacts = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByClient: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findManyByEmails: jest.fn().mockResolvedValue([]),
      findManyByIds: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockImplementation(async (inputs) =>
        inputs.map((i: { id: string; email: string }) => ({ id: i.id, email: i.email })),
      ),
    };
    sequenceContacts = {
      findById: jest.fn(),
      findBySequence: jest.fn().mockResolvedValue([]),
      findByContactAndSequence: jest.fn(),
      findByContact: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn().mockResolvedValue([]),
      bulkSetScheduled: jest.fn(),
      conditionalRemove: jest.fn(),
      bulkRemoveByCompany: jest.fn(),
    };
    sequences = {
      findById: jest.fn().mockResolvedValue({
        id: 'seq_1',
        organizationId: orgId,
        mailboxId: 'mailbox_1',
        executiveId: 'exec_1',
        sequenceVersion: 0,
      }),
      findByExecutive: jest.fn(),
      findByClient: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      conditionalUpdatePublishStatus: jest.fn(),
    };
    steps = {
      findById: jest.fn(),
      findBySequence: jest.fn().mockResolvedValue([
        { id: 'step_1', sequenceId: 'seq_1', position: 1, status: 'PUBLISHED' },
      ]),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    managedClients = {
      findById: jest.fn().mockResolvedValue({ id: 'mc_1', organizationId: orgId, crmClientId: 2001 }),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findByCrmClientId: jest.fn(), findByServerClientId: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    crmEligibility = {
      getVerifiedActiveClient: jest.fn().mockResolvedValue({ crmClientId: 2001, status: 'ACTIVO' }),
    };
    idempotency = {
      checkExisting: jest.fn().mockResolvedValue(null),
      claim: jest.fn(),
      refreshResultSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    integration = { dispatchExistingCommand: jest.fn().mockResolvedValue({ status: 'ACCEPTED' }) };

    imports.findById.mockResolvedValue({
      id: 'import_1',
      organizationId: orgId,
      clientId: 'mc_1',
      sequenceId: 'seq_1',
      status: 'READY',
      checksum: 'checksum-abc',
      columnMapping: { email: 'email', customFields: {} },
      storageKey: 'key',
      executiveId: 'exec_1',
      mailboxId: 'mailbox_1',
    } as never);
    importRows.findByImport.mockResolvedValue([buildImportRow()]);
    idempotency.claim.mockImplementation(
      async (_ctx, input, resultSnapshot, httpStatusCode) =>
        ({
          id: 'cmdrow_1',
          organizationId: input.organizationId,
          commandId: input.commandId,
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
          resultSnapshot,
          httpStatusCode,
        }) as never,
    );

    imports.update.mockImplementation(async (id, patch) => ({
      id,
      organizationId: orgId,
      clientId: 'mc_1',
      sequenceId: 'seq_1',
      status: (patch as { status?: string }).status ?? 'READY',
      checksum: 'checksum-abc',
    } as never));

    useCase = new ConfirmProspectImportUseCase(
      new FakeTransactionManager(),
      imports,
      importRows,
      companies,
      contacts,
      sequenceContacts,
      sequences,
      steps,
      managedClients,
      auditLogs,
      crmEligibility as unknown as CrmClientEligibilityService,
      idempotency as unknown as IdempotentOperationService,
      integration as unknown as IntegrationService,
    );
  });

  it('confirms an import end-to-end: creates companies/contacts, enrolls, claims the command', async () => {
    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result.status).toBe('COMPLETED');
    expect(result.totalProcessed).toBe(1);
    expect(result.companiesCreated).toBe(1);
    expect(result.contactsCreated).toBe(1);
    expect(result.contactsEnrolled).toBe(1);
    expect(companies.createMany).toHaveBeenCalledTimes(1);
    expect(contacts.createMany).toHaveBeenCalledTimes(1);
    expect(sequenceContacts.createMany).toHaveBeenCalledTimes(1);
    expect(importRows.bulkSetContactAndNormalizedData).toHaveBeenCalledTimes(1);
    expect(imports.conditionalUpdateStatus).toHaveBeenCalledWith('import_1', 'READY', 'PROCESSING', expect.anything());
    expect(idempotency.claim).toHaveBeenCalledTimes(1);
    expect(integration.dispatchExistingCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects a 404 for an import that does not belong to this organization', async () => {
    imports.findById.mockResolvedValue({ id: 'import_1', organizationId: 'other_org', status: 'READY' } as never);
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('rejects a 404 when the import does not belong to the given sequence', async () => {
    imports.findById.mockResolvedValue({
      id: 'import_1',
      organizationId: orgId,
      sequenceId: 'seq_other',
      status: 'READY',
    } as never);
    await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
  });

  it('rejects with 409 when the import is not in READY status', async () => {
    imports.findById.mockResolvedValue({
      id: 'import_1',
      organizationId: orgId,
      sequenceId: 'seq_1',
      status: 'COMPLETED',
    } as never);
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('rejects 3001 rows with 400 before opening the transaction', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => buildImportRow({}, i + 1));
    importRows.findByImport.mockResolvedValue(rows);

    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
    expect(imports.conditionalUpdateStatus).not.toHaveBeenCalled();
  });

  it('propagates 409 when the CRM reports the client inactive', async () => {
    crmEligibility.getVerifiedActiveClient.mockRejectedValue(new ConflictException('inactive'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(imports.conditionalUpdateStatus).not.toHaveBeenCalled();
  });

  it('propagates 503 when the CRM is unavailable', async () => {
    crmEligibility.getVerifiedActiveClient.mockRejectedValue(new ServiceUnavailableException('down'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ServiceUnavailableException);
  });

  it('rejects with 409 when the sequence has no published step', async () => {
    steps.findBySequence.mockResolvedValue([{ id: 'step_1', sequenceId: 'seq_1', position: 1, status: 'DRAFT' } as never]);
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('returns the persisted result on an idempotent retry without repeating any write', async () => {
    const previousResult = { importId: 'import_1', status: 'COMPLETED', totalProcessed: 1 };
    idempotency.checkExisting.mockResolvedValue({ resultSnapshot: previousResult, httpStatusCode: 201 } as never);

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result).toEqual(previousResult);
    expect(imports.conditionalUpdateStatus).not.toHaveBeenCalled();
    expect(companies.createMany).not.toHaveBeenCalled();
  });

  it('lets a 409 from checkExisting (same key, different payload) propagate as-is', async () => {
    idempotency.checkExisting.mockRejectedValue(new ConflictException('payload mismatch'));
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
  });

  it('rolls back (in the atomic-claim sense) when the conditional claim fails — concurrent confirmation', async () => {
    imports.conditionalUpdateStatus.mockResolvedValue(0);
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(companies.createMany).not.toHaveBeenCalled();
  });

  it('never enrolls a contact twice in the same sequence (already-enrolled skipped)', async () => {
    sequenceContacts.findBySequence.mockResolvedValue([
      { contactId: 'existing_contact_id' } as never,
    ]);
    contacts.findManyByEmails.mockResolvedValue([{ id: 'existing_contact_id', email: 'contacto1@empresa.cl' } as never]);

    const { result } = await useCase.execute(baseInput());

    expect(result.contactsEnrolled).toBe(0);
    expect(result.contactsReused).toBe(1);
    // Nothing new to enroll — the batch loop has zero chunks, so createMany is never called at all.
    expect(sequenceContacts.createMany).not.toHaveBeenCalled();
  });

  it('extracts custom variables, normalizes keys and excludes reserved base names', async () => {
    imports.findById.mockResolvedValue({
      id: 'import_1',
      organizationId: orgId,
      clientId: 'mc_1',
      sequenceId: 'seq_1',
      status: 'READY',
      checksum: 'checksum-abc',
      columnMapping: {
        email: 'email',
        customFields: { Industria: 'ciudad', empresa: 'empresa' /* reserved — must be ignored */ },
      },
    } as never);

    await useCase.execute(baseInput());

    const [batch] = importRows.bulkSetContactAndNormalizedData.mock.calls[0];
    expect(batch[0].normalizedData.customFields).toEqual({ industria: 'Santiago' });
    expect(batch[0].normalizedData.customFields).not.toHaveProperty('empresa');
  });

  it('never persists "undefined"/"null" strings for a missing custom field value', async () => {
    importRows.findByImport.mockResolvedValue([
      buildImportRow({ rawData: { email: 'contacto1@empresa.cl' /* no "ciudad" column present */ } }),
    ]);
    imports.findById.mockResolvedValue({
      id: 'import_1',
      organizationId: orgId,
      clientId: 'mc_1',
      sequenceId: 'seq_1',
      status: 'READY',
      checksum: 'checksum-abc',
      columnMapping: { email: 'email', customFields: { industria: 'ciudad' } },
    } as never);

    await useCase.execute(baseInput());

    const [batch] = importRows.bulkSetContactAndNormalizedData.mock.calls[0];
    expect(batch[0].normalizedData.customFields).toEqual({});
  });

  it('rolls back everything (no claim, no dispatch) when a mid-batch write fails', async () => {
    contacts.createMany.mockRejectedValue(new Error('db exploded'));
    await expect(useCase.execute(baseInput())).rejects.toThrow('db exploded');
    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(integration.dispatchExistingCommand).not.toHaveBeenCalled();
  });

  it('still returns success when the post-commit dispatch fails', async () => {
    integration.dispatchExistingCommand.mockRejectedValue(new Error('engine hiccup'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result, httpStatus } = await useCase.execute(baseInput());

    expect(httpStatus).toBe(201);
    expect(result.commandStatus).toBe('REQUESTED');
    consoleSpy.mockRestore();
  });
});
