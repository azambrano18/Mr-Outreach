import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceExecutionMotorPort } from '../../domain/sequence-execution-motor/sequence-execution-motor-port';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ExecutiveMailboxEligibilityService } from '../sequence-templates/executive-mailbox-eligibility.service';
import { ProspectIdentityResolver } from '../prospect-imports/prospect-identity-resolver.service';
import { ProspectImportsService } from '../prospect-imports/prospect-imports.service';
import { SequenceExecutionsService } from './sequence-executions.service';
import { StartSequenceExecutionUseCase } from './start-sequence-execution.use-case';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('StartSequenceExecutionUseCase — §1-7/§12 contrato simplificado', () => {
  let executions: jest.Mocked<Pick<SequenceExecutionRepository, 'conditionalUpdateStatus' | 'update' | 'findByExecutive'>>;
  let templateVersions: jest.Mocked<Pick<SequenceTemplateVersionRepository, 'findById'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let motor: jest.Mocked<Pick<SequenceExecutionMotorPort, 'startExecution'>>;
  let executionsService: jest.Mocked<Pick<SequenceExecutionsService, 'requireOwned' | 'getOwned'>>;
  let eligibility: jest.Mocked<Pick<ExecutiveMailboxEligibilityService, 'requireEligible'>>;
  let prospectImports: jest.Mocked<Pick<ProspectImportsService, 'getImportForExecution' | 'getValidRows' | 'markAccepted'>>;
  let prospectIdentity: jest.Mocked<Pick<ProspectIdentityResolver, 'resolveForExecution'>>;
  let secrets: jest.Mocked<Pick<SecretEncryptionService, 'encrypt' | 'decrypt'>>;
  let commands: jest.Mocked<Pick<IntegrationCommandRepository, 'findByIdempotencyKey' | 'create' | 'update'>>;
  let useCase: StartSequenceExecutionUseCase;

  const orgId = 'org_1';
  const executiveId = 'exec_1';
  const executionId = 'exec_run_1';

  const draftExecution = {
    id: executionId,
    organizationId: orgId,
    executiveId,
    mailboxId: 'mailbox_1',
    templateId: 'tpl_1',
    templateVersionId: 'version_1',
    name: null as string | null,
    timezone: 'America/Santiago',
    status: 'DRAFT',
    requestedAt: null,
    lastSubmissionIdempotencyKey: null as string | null,
  };

  const mailbox = { id: 'mailbox_1', serverMailboxId: 'srv_1' };

  const version = {
    id: 'version_1',
    status: 'ACCEPTED',
    serverTemplateId: 'tpl_server_1',
    templateTokenCiphertext: 'enc(token)',
    versionNumber: 1,
  };

  const importRecord = {
    id: 'import_1',
    status: 'READY',
    columnMapping: { email: 'Correo', contactName: null, companyName: null, customVariables: {} },
  };

  const validRow = {
    id: 'row_1',
    normalizedData: { email: 'persona@empresa.cl', contactName: 'María', companyName: 'Empresa Uno', variables: { industry: 'Tecnología' } },
  };

  function baseInput() {
    return { organizationId: orgId, executiveId, executionId, idempotencyKey: 'idem_1' };
  }

  beforeEach(() => {
    executions = {
      conditionalUpdateStatus: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(draftExecution),
      findByExecutive: jest.fn().mockResolvedValue([]),
    };
    templateVersions = { findById: jest.fn().mockResolvedValue(version) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    motor = { startExecution: jest.fn() };
    executionsService = {
      requireOwned: jest.fn().mockResolvedValue(draftExecution),
      getOwned: jest.fn().mockResolvedValue({ id: executionId, status: 'ACCEPTED' }),
    };
    eligibility = { requireEligible: jest.fn().mockResolvedValue(mailbox) };
    prospectImports = {
      getImportForExecution: jest.fn().mockResolvedValue(importRecord),
      getValidRows: jest.fn().mockResolvedValue([validRow]),
      markAccepted: jest.fn().mockResolvedValue(undefined),
    };
    prospectIdentity = { resolveForExecution: jest.fn().mockResolvedValue(undefined) };
    secrets = { encrypt: jest.fn().mockReturnValue('enc(exec-token)'), decrypt: jest.fn().mockReturnValue('tpt_plaintext') };
    commands = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'command_row_1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    useCase = new StartSequenceExecutionUseCase(
      executions as unknown as SequenceExecutionRepository,
      templateVersions as unknown as SequenceTemplateVersionRepository,
      audit as unknown as AuditLogRepository,
      motor as unknown as SequenceExecutionMotorPort,
      new FakeTransactionManager(),
      commands as unknown as IntegrationCommandRepository,
      executionsService as unknown as SequenceExecutionsService,
      eligibility as unknown as ExecutiveMailboxEligibilityService,
      prospectImports as unknown as ProspectImportsService,
      prospectIdentity as unknown as ProspectIdentityResolver,
      secrets as unknown as SecretEncryptionService,
    );
  });

  function acceptedResult(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      accepted: true as const,
      serverExecutionId: 'srv_exec_1',
      executionToken: 'ext_1',
      status: 'ACCEPTED' as const,
      receivedProspects: 1,
      acceptedProspects: 1,
      rejectedProspects: 0,
      initialProspectState: 'STEP_01_PENDING' as const,
      receivedAt: new Date(),
      rejectionReason: null,
      ...overrides,
    };
  }

  it('rejects a fresh submit attempt while already ACCEPTED/RUNNING/COMPLETED', async () => {
    executionsService.requireOwned.mockResolvedValue({ ...draftExecution, status: 'ACCEPTED' } as any);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
    expect(motor.startExecution).not.toHaveBeenCalled();
  });

  it('rejects a concurrent fresh submit that loses the atomic SUBMITTING claim', async () => {
    executions.conditionalUpdateStatus.mockResolvedValue(0);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
    expect(motor.startExecution).not.toHaveBeenCalled();
  });

  it('re-validates mailbox eligibility fail-closed even though it was checked at creation time (local only — never sent to the server)', async () => {
    motor.startExecution.mockResolvedValue(acceptedResult());
    await useCase.execute(baseInput());
    expect(eligibility.requireEligible).toHaveBeenCalledWith(orgId, executiveId, draftExecution.mailboxId);
    const call = motor.startExecution.mock.calls[0][0];
    expect(call).not.toHaveProperty('mailboxId');
    expect(call).not.toHaveProperty('serverMailboxId');
  });

  it('rejects when the template version is no longer ACCEPTED', async () => {
    templateVersions.findById.mockResolvedValue({ ...version, status: 'FAILED' } as any);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when there is no ready prospect import', async () => {
    prospectImports.getImportForExecution.mockResolvedValue(null);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when there are zero valid prospect rows', async () => {
    prospectImports.getValidRows.mockResolvedValue([]);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never claims SUBMITTING nor calls the motor when pre-flight validation fails, leaving the Gestión untouched (still DRAFT)', async () => {
    prospectImports.getValidRows.mockResolvedValue([]);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(BadRequestException);
    expect(executions.conditionalUpdateStatus).not.toHaveBeenCalled();
    expect(motor.startExecution).not.toHaveBeenCalled();
  });

  it('generates the Gestión name from the real submission moment (backend-side), never from the browser, and never sends it to the server', async () => {
    motor.startExecution.mockResolvedValue(acceptedResult());
    await useCase.execute(baseInput());
    const call = executions.update.mock.calls.find(([, input]) => (input as any).name);
    expect(call?.[1]).toEqual(expect.objectContaining({ name: expect.stringMatching(/^Gestión_\d{8}$/) }));
    const motorCall = motor.startExecution.mock.calls[0][0];
    expect(motorCall).not.toHaveProperty('name');
  });

  it('adds an underscore-suffixed correlativo when the executive already has a Gestión with that name', async () => {
    motor.startExecution.mockResolvedValue(acceptedResult());
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const base = `Gestión_${dd}${mm}${yyyy}`;
    executions.findByExecutive.mockResolvedValue([{ name: base } as any]);
    await useCase.execute(baseInput());
    const call = executions.update.mock.calls.find(([, input]) => (input as any).name);
    expect(call?.[1]).toEqual(expect.objectContaining({ name: `${base}_2` }));
  });

  it('the JSON sent to the motor is limited to serverTemplateId, localExecutionId, idempotencyKey/correlationId and normalized prospects — nothing else', async () => {
    motor.startExecution.mockResolvedValue(acceptedResult());
    await useCase.execute(baseInput());
    const call = motor.startExecution.mock.calls[0][0];
    expect(Object.keys(call).sort()).toEqual(['correlationId', 'idempotencyKey', 'localExecutionId', 'prospects', 'serverTemplateId']);
    expect(call.serverTemplateId).toBe('tpl_server_1');
  });

  it('never includes queue/dispatch instructions, a technical owner, an initial step, or a scheduled date in the JSON sent to the motor', async () => {
    motor.startExecution.mockResolvedValue(acceptedResult());
    await useCase.execute(baseInput());
    const call = motor.startExecution.mock.calls[0][0] as unknown as Record<string, unknown>;
    for (const forbidden of [
      'submissionMode',
      'queueManagement',
      'dispatch',
      'enqueuePolicy',
      'startPolicy',
      'queueName',
      'queueId',
      'queuePosition',
      'priority',
      'worker',
      'processor',
      'technicalOwner',
      'responsible',
      'executive',
      'executiveUserId',
      'organizationId',
      'initialStep',
      'currentStep',
      'startAt',
      'scheduledAt',
      'requestedAt',
      'requestedDate',
      'requestedStartDate',
      'requestedStartTime',
      'templateToken',
      'mapping',
      'timezone',
    ]) {
      expect(call).not.toHaveProperty(forbidden);
    }
  });

  it('never decrypts nor sends the template token to the motor — serverTemplateId is the only template reference', async () => {
    motor.startExecution.mockResolvedValue(acceptedResult());
    await useCase.execute(baseInput());
    expect(secrets.decrypt).not.toHaveBeenCalled();
  });

  it('bundles every valid row into one call — email/contact_name/company_name/custom variables folded together, raw file data never included', async () => {
    motor.startExecution.mockResolvedValue(acceptedResult());
    await useCase.execute(baseInput());
    expect(motor.startExecution).toHaveBeenCalledTimes(1);
    const call = motor.startExecution.mock.calls[0][0];
    expect(call.prospects).toEqual([
      {
        localProspectId: 'row_1',
        email: 'persona@empresa.cl',
        variables: { contact_name: 'María', company_name: 'Empresa Uno', industry: 'Tecnología' },
      },
    ]);
  });

  it('on acceptance: persists ACCEPTED, serverExecutionId, receivedAt, encrypts the executionToken, and stamps every valid row as STEP_01_PENDING', async () => {
    const receivedAt = new Date();
    motor.startExecution.mockResolvedValue(acceptedResult({ executionToken: 'ext_plaintext', receivedAt }));
    await useCase.execute(baseInput());
    expect(secrets.encrypt).toHaveBeenCalledWith('ext_plaintext');
    expect(executions.update).toHaveBeenCalledWith(
      executionId,
      expect.objectContaining({
        status: 'ACCEPTED',
        executionTokenCiphertext: 'enc(exec-token)',
        serverExecutionId: 'srv_exec_1',
        receivedAt,
        initialProspectState: 'STEP_01_PENDING',
      }),
      expect.anything(),
    );
    expect(prospectImports.markAccepted).toHaveBeenCalledWith(executionId, 'STEP_01_PENDING');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sequence_execution.accepted' }),
      expect.anything(),
    );
  });

  it('defaults to STEP_01_PENDING locally even when the server response omits initialProspectState', async () => {
    motor.startExecution.mockResolvedValue(acceptedResult({ initialProspectState: null }));
    await useCase.execute(baseInput());
    expect(executions.update).toHaveBeenCalledWith(executionId, expect.objectContaining({ initialProspectState: 'STEP_01_PENDING' }), expect.anything());
    expect(prospectImports.markAccepted).toHaveBeenCalledWith(executionId, 'STEP_01_PENDING');
  });

  it('marks the Gestión REJECTED (not FAILED) when the motor declines the submission', async () => {
    motor.startExecution.mockResolvedValue({
      accepted: false,
      serverExecutionId: null,
      executionToken: null,
      status: 'REJECTED',
      receivedProspects: 0,
      acceptedProspects: 0,
      rejectedProspects: 0,
      initialProspectState: null,
      receivedAt: null,
      rejectionReason: 'Cuenta revocada.',
    });
    await useCase.execute(baseInput());
    expect(executions.update).toHaveBeenCalledWith(executionId, expect.objectContaining({ status: 'REJECTED', lastError: 'Cuenta revocada.' }), expect.anything());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sequence_execution.rejected' }),
      expect.anything(),
    );
    expect(prospectImports.markAccepted).not.toHaveBeenCalled();
  });

  it('on a motor timeout: leaves the Gestión as SUBMISSION_UNKNOWN, never DRAFT nor FAILED, and never creates a duplicate remote Gestión', async () => {
    motor.startExecution.mockRejectedValue(new ServiceUnavailableException('El servidor motor no está disponible.'));
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(executions.update).toHaveBeenCalledWith(executionId, expect.objectContaining({ status: 'SUBMISSION_UNKNOWN' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sequence_execution.submission_failed' }));
  });

  it('retries a SUBMISSION_UNKNOWN Gestión by reusing the same stored idempotencyKey, without re-claiming SUBMITTING', async () => {
    executionsService.requireOwned.mockResolvedValue({
      ...draftExecution,
      status: 'SUBMISSION_UNKNOWN',
      name: 'Gestión_28072026',
      lastSubmissionIdempotencyKey: 'original_key',
    } as any);
    motor.startExecution.mockResolvedValue(acceptedResult());

    await useCase.execute({ ...baseInput(), idempotencyKey: 'a_brand_new_key_from_a_second_click' });

    expect(executions.conditionalUpdateStatus).not.toHaveBeenCalled();
    expect(motor.startExecution).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'original_key' }));
  });

  it('a double click (two concurrent fresh submits) never results in two motor calls succeeding — the loser gets a 409', async () => {
    executions.conditionalUpdateStatus.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    motor.startExecution.mockResolvedValue(acceptedResult());

    const first = useCase.execute(baseInput());
    const second = useCase.execute(baseInput());
    const results = await Promise.allSettled([first, second]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(motor.startExecution).toHaveBeenCalledTimes(1);
  });

  describe('durable IntegrationCommand traceability (EXECUTION aggregate — Fase "Comandos y eventos del flujo activo")', () => {
    it('creates a REQUESTED IntegrationCommand for a fresh submit, before the motor is called', async () => {
      motor.startExecution.mockResolvedValue(acceptedResult());
      await useCase.execute(baseInput());
      expect(commands.findByIdempotencyKey).toHaveBeenCalledWith(orgId, expect.stringContaining('idem_1'), expect.anything());
      expect(commands.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          commandType: 'SEQUENCE_EXECUTION_START_REQUESTED',
          aggregateType: 'EXECUTION',
          aggregateId: executionId,
        }),
        expect.anything(),
      );
    });

    it('marks the IntegrationCommand COMPLETED when the motor accepts', async () => {
      motor.startExecution.mockResolvedValue(acceptedResult());
      await useCase.execute(baseInput());
      expect(commands.update).toHaveBeenCalledWith(
        'command_row_1',
        expect.objectContaining({ status: 'COMPLETED' }),
        expect.anything(),
      );
    });

    it('marks the IntegrationCommand FAILED when the motor rejects', async () => {
      motor.startExecution.mockResolvedValue({
        accepted: false,
        serverExecutionId: null,
        executionToken: null,
        status: 'REJECTED',
        receivedProspects: 0,
        acceptedProspects: 0,
        rejectedProspects: 0,
        initialProspectState: null,
        receivedAt: null,
        rejectionReason: 'Cuenta revocada.',
      });
      await useCase.execute(baseInput());
      expect(commands.update).toHaveBeenCalledWith(
        'command_row_1',
        expect.objectContaining({ status: 'FAILED', lastError: 'Cuenta revocada.' }),
        expect.anything(),
      );
    });

    it('leaves the IntegrationCommand REQUESTED (never marks it COMPLETED/FAILED) on a motor timeout — recoverable only by a manual retry', async () => {
      motor.startExecution.mockRejectedValue(new ServiceUnavailableException('El servidor motor no está disponible.'));
      await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(commands.update).not.toHaveBeenCalled();
    });

    it('reuses the existing IntegrationCommand row on a retry instead of creating a second one', async () => {
      commands.findByIdempotencyKey.mockResolvedValue({ id: 'existing_command_row' } as never);
      executionsService.requireOwned.mockResolvedValue({
        ...draftExecution,
        status: 'SUBMISSION_UNKNOWN',
        lastSubmissionIdempotencyKey: 'original_key',
      } as any);
      motor.startExecution.mockResolvedValue(acceptedResult());

      await useCase.execute({ ...baseInput(), idempotencyKey: 'a_brand_new_key_from_a_second_click' });

      expect(commands.create).not.toHaveBeenCalled();
      expect(commands.update).toHaveBeenCalledWith('existing_command_row', expect.objectContaining({ status: 'COMPLETED' }), expect.anything());
    });
  });
});
