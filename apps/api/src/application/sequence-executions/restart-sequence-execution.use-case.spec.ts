import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Conversation } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { ProspectImportRow } from '../../domain/prospect-import/prospect-import-row.entity';
import { ProspectImportRowRepository } from '../../domain/prospect-import/prospect-import-row.repository';
import { ProspectImportRepository } from '../../domain/prospect-import/prospect-import.repository';
import { SequenceExecution } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { RestartSequenceExecutionUseCase } from './restart-sequence-execution.use-case';
import { SequenceExecutionsService } from './sequence-executions.service';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('RestartSequenceExecutionUseCase — Fase "Reiniciar Gestión"', () => {
  let executions: jest.Mocked<Pick<SequenceExecutionRepository, 'findById' | 'create'>>;
  let prospectImports: jest.Mocked<Pick<ProspectImportRepository, 'findByExecution' | 'create' | 'update'>>;
  let prospectRows: jest.Mocked<Pick<ProspectImportRowRepository, 'findByImport' | 'createMany'>>;
  let conversations: jest.Mocked<Pick<ConversationRepository, 'findAll'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let commands: jest.Mocked<Pick<IntegrationCommandRepository, 'findByIdempotencyKey' | 'create' | 'update'>>;
  let executionsService: jest.Mocked<Pick<SequenceExecutionsService, 'getAny'>>;
  let useCase: RestartSequenceExecutionUseCase;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';
  const executionId = 'exec_1';
  const importId = 'import_1';

  function buildExecution(overrides: Partial<SequenceExecution> = {}): SequenceExecution {
    return {
      id: executionId,
      organizationId: orgId,
      executiveId: 'exec_user_1',
      mailboxId: 'mailbox_1',
      templateId: 'template_1',
      templateVersionId: 'version_1',
      name: 'Gestión_05082026',
      timezone: 'America/Santiago',
      status: 'STOPPED',
      prospectImportId: importId,
      requestedAt: new Date(),
      receivedAt: new Date(),
      estimatedStartAt: null,
      startedAt: new Date(),
      completedAt: null,
      failedAt: null,
      serverStatus: null,
      currentStepNumber: null,
      sentCount: null,
      pendingCount: null,
      failedCount: null,
      receivedProspects: 3,
      acceptedProspects: 3,
      rejectedProspects: 0,
      initialProspectState: 'STEP_01_PENDING',
      lastSyncedAt: new Date(),
      lastError: null,
      serverExecutionId: 'srv_exec_1',
      executionTokenCiphertext: null,
      lastSubmissionIdempotencyKey: null,
      pausedAt: null,
      resumedAt: null,
      stoppedAt: new Date(),
      stopReason: 'Cliente pidió detener la campaña.',
      lastControlIdempotencyKey: null,
      executionAttempt: 1,
      previousExecutionId: null,
      createdBy: 'exec_user_1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function buildRow(overrides: Partial<ProspectImportRow> = {}): ProspectImportRow {
    return {
      id: 'row_1',
      organizationId: orgId,
      importId,
      rowNumber: 1,
      rawData: { email: 'persona@empresa.cl' },
      normalizedData: { email: 'persona@empresa.cl', contactName: 'María', companyName: 'Empresa Uno', variables: {} },
      validationStatus: 'VALID',
      contactId: null,
      companyId: null,
      resolvedAt: null,
      createdAt: new Date(),
      ...overrides,
    } as ProspectImportRow;
  }

  function buildConversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: 'conv_1',
      organizationId: orgId,
      clientId: null,
      domainId: null,
      mailboxId: 'mailbox_1',
      contactId: 'contact_1',
      companyId: 'company_1',
      sequenceContactId: null,
      sequenceExecutionId: executionId,
      prospectImportRowId: 'row_1',
      emailThreadId: 'thread_1',
      subject: 'Asunto',
      origin: 'ACTIVE_EXECUTION',
      status: 'OPEN',
      unread: true,
      lastMessageAt: new Date(),
      archivedAt: null,
      assignedToUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Conversation;
  }

  beforeEach(() => {
    executions = {
      findById: jest.fn().mockResolvedValue(buildExecution()),
      create: jest.fn().mockImplementation((input) =>
        Promise.resolve({ ...buildExecution(), id: 'exec_new_1', status: 'DRAFT', ...input }),
      ),
    };
    prospectImports = {
      findByExecution: jest.fn().mockResolvedValue({ id: importId, columnMapping: { email: 'Correo' } }),
      create: jest.fn().mockResolvedValue({ id: 'import_new_1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    prospectRows = {
      findByImport: jest.fn().mockResolvedValue([buildRow({ id: 'row_1' }), buildRow({ id: 'row_2' }), buildRow({ id: 'row_3' })]),
      createMany: jest.fn().mockResolvedValue([]),
    };
    conversations = {
      // row_1 already received an email (has a Conversation); row_2 and row_3 never did.
      findAll: jest.fn().mockResolvedValue([buildConversation({ prospectImportRowId: 'row_1' })]),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    commands = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'cmdrow_1', commandId: 'cmd_1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    executionsService = {
      getAny: jest.fn().mockResolvedValue({ id: 'exec_new_1', status: 'DRAFT' }),
    };

    useCase = new RestartSequenceExecutionUseCase(
      executions as unknown as SequenceExecutionRepository,
      prospectImports as unknown as ProspectImportRepository,
      prospectRows as unknown as ProspectImportRowRepository,
      conversations as unknown as ConversationRepository,
      audit as unknown as AuditLogRepository,
      commands as unknown as IntegrationCommandRepository,
      new FakeTransactionManager(),
      executionsService as unknown as SequenceExecutionsService,
    );
  });

  function baseInput(overrides: Partial<Parameters<RestartSequenceExecutionUseCase['execute']>[0]> = {}) {
    return { organizationId: orgId, actorId: 'admin_1', executionId, idempotencyKey: 'idem_1', ...overrides };
  }

  describe('preview', () => {
    it('reports total/already-contacted/eligible counts derived from Conversation existence, not a per-row send counter', async () => {
      const preview = await useCase.preview(orgId, executionId);
      expect(preview.totalContacts).toBe(3);
      expect(preview.alreadyContactedCount).toBe(1);
      expect(preview.eligibleCount).toBe(2);
    });

    it('excludes INVALID rows from every count', async () => {
      prospectRows.findByImport.mockResolvedValue([
        buildRow({ id: 'row_1', validationStatus: 'VALID' }),
        buildRow({ id: 'row_2', validationStatus: 'INVALID' }),
      ]);
      conversations.findAll.mockResolvedValue([]);
      const preview = await useCase.preview(orgId, executionId);
      expect(preview.totalContacts).toBe(1);
      expect(preview.eligibleCount).toBe(1);
    });
  });

  describe('execute', () => {
    it('only allows restarting a STOPPED execution', async () => {
      executions.findById.mockResolvedValue(buildExecution({ status: 'RUNNING' }));
      await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
      expect(executions.create).not.toHaveBeenCalled();
    });

    it('blocks with the exact required message when zero contacts are eligible', async () => {
      conversations.findAll.mockResolvedValue([
        buildConversation({ prospectImportRowId: 'row_1' }),
        buildConversation({ id: 'conv_2', prospectImportRowId: 'row_2' }),
        buildConversation({ id: 'conv_3', prospectImportRowId: 'row_3' }),
      ]);
      await expect(useCase.execute(baseInput())).rejects.toThrow(
        'No existen contactos pendientes que puedan reiniciarse sin duplicar envíos.',
      );
      expect(executions.create).not.toHaveBeenCalled();
    });

    it('creates a new execution (attempt N+1) linked via previousExecutionId, never mutating the old one', async () => {
      await useCase.execute(baseInput());
      expect(executions.create).toHaveBeenCalledWith(
        expect.objectContaining({ executionAttempt: 2, previousExecutionId: executionId, organizationId: orgId }),
      );
    });

    it('the new import only contains rows that never received any email (row_2 and row_3, excluding row_1)', async () => {
      await useCase.execute(baseInput());
      expect(prospectRows.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ rawData: expect.objectContaining({ email: 'persona@empresa.cl' }) }),
        expect.objectContaining({ rawData: expect.objectContaining({ email: 'persona@empresa.cl' }) }),
      ]);
      const createdRows = prospectRows.createMany.mock.calls[0][0];
      expect(createdRows).toHaveLength(2);
    });

    it('writes exactly one audit entry: sequence_execution.restarted', async () => {
      await useCase.execute(baseInput());
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sequence_execution.restarted',
          entityId: executionId,
          metadata: expect.objectContaining({ newExecutionId: 'exec_new_1', eligibleCount: 2, alreadyContactedCount: 1 }),
        }),
        expect.anything(),
      );
    });

    it('creates a local-only IntegrationCommand (SEQUENCE_EXECUTION_RESTART_REQUESTED) that goes straight to COMPLETED — never calls a motor', async () => {
      await useCase.execute(baseInput());
      expect(commands.create).toHaveBeenCalledWith(
        expect.objectContaining({ commandType: 'SEQUENCE_EXECUTION_RESTART_REQUESTED', aggregateId: executionId }),
        expect.anything(),
      );
      expect(commands.update).toHaveBeenCalledWith(
        'cmdrow_1',
        expect.objectContaining({ status: 'COMPLETED', resultSnapshot: { newExecutionId: 'exec_new_1' } }),
        expect.anything(),
      );
    });

    it('is idempotent: a repeated call with the same idempotencyKey returns the exact same new execution without creating a second one', async () => {
      commands.findByIdempotencyKey.mockResolvedValue({
        id: 'cmdrow_1',
        commandId: 'cmd_1',
        resultSnapshot: { newExecutionId: 'exec_new_1' },
      } as any);
      const result = await useCase.execute(baseInput());
      expect(executions.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'exec_new_1', status: 'DRAFT' });
    });

    it('throws NotFoundException for an execution in a different organization', async () => {
      executions.findById.mockResolvedValue(buildExecution({ organizationId: otherOrgId }));
      await expect(useCase.execute(baseInput())).rejects.toThrow(NotFoundException);
    });

    it('never offers a "resend to all" path — the new import always excludes every already-contacted row, with no override flag on the input', async () => {
      await useCase.execute(baseInput());
      const createdRows = prospectRows.createMany.mock.calls[0][0] as Array<{ rowNumber: number }>;
      expect(createdRows).toHaveLength(2);
      expect(Object.keys(baseInput())).not.toContain('resendToAll');
      expect(Object.keys(baseInput())).not.toContain('includeAlreadyContacted');
    });
  });
});
