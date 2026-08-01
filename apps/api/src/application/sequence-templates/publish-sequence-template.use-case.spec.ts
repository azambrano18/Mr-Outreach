import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { TransactionContext, TransactionManager } from '../../domain/persistence/transaction';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { SequenceTemplateMotorPort } from '../../domain/sequence-template-motor/sequence-template-motor-port';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ExecutiveMailboxEligibilityService } from './executive-mailbox-eligibility.service';
import { PublishSequenceTemplateUseCase } from './publish-sequence-template.use-case';
import { SequenceTemplatesService } from './sequence-templates.service';

class FakeTransactionManager implements TransactionManager {
  async run<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ kind: 'fake' });
  }
}

describe('PublishSequenceTemplateUseCase', () => {
  let templates: jest.Mocked<Pick<SequenceTemplateRepository, 'conditionalUpdateStatus' | 'update'>>;
  let versions: jest.Mocked<Pick<SequenceTemplateVersionRepository, 'create' | 'update'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let motor: jest.Mocked<Pick<SequenceTemplateMotorPort, 'publishTemplate'>>;
  let templatesService: jest.Mocked<
    Pick<SequenceTemplatesService, 'requireOwned' | 'getStepsForPublish' | 'validateForPublish' | 'getSignatureHtmlForMailbox'>
  >;
  let eligibility: jest.Mocked<Pick<ExecutiveMailboxEligibilityService, 'requireEligible'>>;
  let secrets: jest.Mocked<Pick<SecretEncryptionService, 'encrypt' | 'decrypt'>>;
  let commands: jest.Mocked<Pick<IntegrationCommandRepository, 'findByIdempotencyKey' | 'create' | 'update'>>;
  let useCase: PublishSequenceTemplateUseCase;

  const orgId = 'org_1';
  const templateId = 'tpl_1';
  const actorId = 'exec_1';

  const template = {
    id: templateId,
    organizationId: orgId,
    ownerUserId: actorId,
    mailboxId: 'mailbox_1',
    name: 'Plantilla - Empresa Demostración',
    subjectTemplate: 'Hola {contact_name}',
    headerText: null,
    signatureHtml: '<p>Firma</p>',
    status: 'DRAFT',
    currentDraftVersion: 1,
    timezone: 'America/Santiago',
  };
  const mailbox = { id: 'mailbox_1', serverMailboxId: 'srv_1', email: 'ventas@empresa.cl' };

  function validStep(stepNumber: 1 | 2 | 3) {
    return {
      id: `step_${stepNumber}`,
      organizationId: orgId,
      templateId,
      stepNumber,
      headerText: stepNumber === 1 ? 'Hola {contact_name},' : null,
      bodyHtml: `<p>Cuerpo del envío ${stepNumber}. Hola {contact_name} de {company_name}.</p>`,
      bodyText: `Cuerpo del envío ${stepNumber}.`,
      delayValue: stepNumber === 1 ? 0 : 5,
      delayUnit: 'BUSINESS_DAYS' as const,
      delayReference: stepNumber === 1 ? ('EXECUTION_START' as const) : ('PREVIOUS_STEP' as const),
      allowedWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as (
        | 'MONDAY'
        | 'TUESDAY'
        | 'WEDNESDAY'
        | 'THURSDAY'
        | 'FRIDAY'
      )[],
      sendWindowStart: '09:00',
      sendWindowEnd: '17:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  function baseInput() {
    return { organizationId: orgId, templateId, actorId, idempotencyKey: 'idem_1' };
  }

  beforeEach(() => {
    templates = { conditionalUpdateStatus: jest.fn().mockResolvedValue(1), update: jest.fn().mockResolvedValue(template) };
    const createdVersion = {
      id: 'version_1',
      templateId,
      versionNumber: 1,
      name: template.name,
      mailboxId: template.mailboxId,
      timezone: template.timezone,
      subjectTemplate: template.subjectTemplate,
      headerText: template.headerText,
      signatureHtml: '<p>Firma</p>',
      variables: [],
      steps: [],
      status: 'REQUESTED',
      serverTemplateId: null,
      templateTokenCiphertext: null,
      acceptedAt: null,
      lastPublishCommandId: 'cmd_1',
      lastError: null,
      createdBy: actorId,
      createdAt: new Date(),
    };
    versions = {
      create: jest.fn().mockResolvedValue(createdVersion),
      update: jest.fn().mockImplementation(async (id, input) => ({ ...createdVersion, id, ...input })),
    };
    audit = { record: jest.fn() };
    motor = { publishTemplate: jest.fn() };
    templatesService = {
      requireOwned: jest.fn().mockResolvedValue(template),
      getStepsForPublish: jest.fn().mockResolvedValue([validStep(1), validStep(2), validStep(3)]),
      validateForPublish: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
      getSignatureHtmlForMailbox: jest.fn().mockResolvedValue(template.signatureHtml),
    };
    eligibility = { requireEligible: jest.fn().mockResolvedValue(mailbox) };
    secrets = { encrypt: jest.fn().mockReturnValue('enc(token)'), decrypt: jest.fn() };
    commands = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'command_row_1', commandId: 'cmd_1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    useCase = new PublishSequenceTemplateUseCase(
      templates as unknown as SequenceTemplateRepository,
      versions as unknown as SequenceTemplateVersionRepository,
      audit as unknown as AuditLogRepository,
      motor as unknown as SequenceTemplateMotorPort,
      new FakeTransactionManager(),
      commands as unknown as IntegrationCommandRepository,
      templatesService as unknown as SequenceTemplatesService,
      eligibility as unknown as ExecutiveMailboxEligibilityService,
      secrets as unknown as SecretEncryptionService,
    );
  });

  it('rejects with the combined validation errors when validateForPublish reports the template is not ready', async () => {
    templatesService.validateForPublish.mockResolvedValue({ valid: false, errors: ['Envío 2: el cuerpo del correo es obligatorio.'] });
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(BadRequestException);
    expect(motor.publishTemplate).not.toHaveBeenCalled();
    expect(templates.conditionalUpdateStatus).not.toHaveBeenCalled();
  });

  it('rejects a concurrent publish attempt (already PUBLISHING)', async () => {
    templates.conditionalUpdateStatus.mockResolvedValue(0);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
    expect(motor.publishTemplate).not.toHaveBeenCalled();
  });

  it('publishes successfully: creates a version with the shared subject and each envío\'s own header, encrypts the token, and marks the template PUBLISHED', async () => {
    motor.publishTemplate.mockResolvedValue({
      accepted: true,
      serverTemplateId: 'tpl_server_1',
      templateToken: 'tpt_plaintext',
      version: 1,
      status: 'ACCEPTED',
      acceptedAt: new Date(),
      rejectionReason: null,
    });

    const result = await useCase.execute(baseInput());

    expect(templatesService.validateForPublish).toHaveBeenCalledWith(orgId, actorId, templateId);
    expect(eligibility.requireEligible).toHaveBeenCalledWith(orgId, actorId, template.mailboxId);
    expect(secrets.encrypt).toHaveBeenCalledWith('tpt_plaintext');
    expect(versions.create).toHaveBeenCalledWith(expect.objectContaining({ subjectTemplate: template.subjectTemplate }), expect.anything());
    expect(motor.publishTemplate).toHaveBeenCalledWith(expect.objectContaining({ subjectTemplate: template.subjectTemplate }));
    // Fase Firma — the signature comes straight from the template's own draft field, never re-read from the mailbox at publish time.
    expect(versions.create).toHaveBeenCalledWith(expect.objectContaining({ signatureHtml: template.signatureHtml }), expect.anything());
    expect(motor.publishTemplate).toHaveBeenCalledWith(expect.objectContaining({ signatureHtml: template.signatureHtml }));
    // Header is per-envío again — never a root-level field on either the version snapshot or the motor payload.
    const versionCall = versions.create.mock.calls[0][0];
    expect(versionCall).not.toHaveProperty('headerText');
    expect(versionCall.steps.find((s: { stepNumber: number }) => s.stepNumber === 1)).toEqual(
      expect.objectContaining({ headerText: 'Hola {contact_name},' }),
    );
    const motorCall = motor.publishTemplate.mock.calls[0][0];
    expect(motorCall).not.toHaveProperty('headerText');
    expect(motorCall.steps.find((s: { stepNumber: number }) => s.stepNumber === 1)).toEqual(
      expect.objectContaining({ headerText: 'Hola {contact_name},' }),
    );
    // Steps sent to the motor never carry a per-envío subject/enabled.
    for (const step of motorCall.steps) {
      expect(step).not.toHaveProperty('subjectTemplate');
      expect(step).not.toHaveProperty('enabled');
    }
    expect(templates.update).toHaveBeenCalledWith(templateId, { status: 'PUBLISHED' }, expect.anything());
    expect(result.status).toBe('PUBLISHED');
    expect(result.version.templateTokenMasked).not.toContain('tpt_plaintext');
    expect(result.version.templateTokenMasked).toMatch(/^tpt_\*+/);
  });

  it('marks the template PUBLISH_FAILED when the motor rejects the publish', async () => {
    motor.publishTemplate.mockResolvedValue({
      accepted: false,
      serverTemplateId: null,
      templateToken: null,
      version: 1,
      status: 'FAILED',
      acceptedAt: null,
      rejectionReason: 'Motor rejected.',
    });

    const result = await useCase.execute(baseInput());

    expect(templates.update).toHaveBeenCalledWith(templateId, { status: 'PUBLISH_FAILED' }, expect.anything());
    expect(result.status).toBe('PUBLISH_FAILED');
    expect(secrets.encrypt).not.toHaveBeenCalled();
  });

  it('never claims PUBLISHING nor touches the template status when the mailbox eligibility check fails as a pre-flight validation (mirrors StartSequenceExecutionUseCase — a validation failure must never leave the template stuck mid-publish)', async () => {
    eligibility.requireEligible.mockRejectedValue(new ConflictException('no eligible'));
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
    expect(templates.conditionalUpdateStatus).not.toHaveBeenCalled();
    expect(templates.update).not.toHaveBeenCalled();
    expect(versions.create).not.toHaveBeenCalled();
  });

  describe('durable IntegrationCommand traceability (TEMPLATE aggregate — Fase "Comandos y eventos del flujo activo")', () => {
    it('replays the persisted result instead of publishing again when the same idempotencyKey already completed', async () => {
      const priorResult = { templateId, status: 'PUBLISHED', version: { id: 'version_1' } };
      commands.findByIdempotencyKey.mockResolvedValue({ status: 'COMPLETED', resultSnapshot: priorResult } as never);
      const result = await useCase.execute(baseInput());
      expect(result).toEqual(priorResult);
      expect(templates.conditionalUpdateStatus).not.toHaveBeenCalled();
      expect(motor.publishTemplate).not.toHaveBeenCalled();
    });

    it('creates a REQUESTED IntegrationCommand for a fresh publish, before the motor is called', async () => {
      motor.publishTemplate.mockResolvedValue({
        accepted: true,
        serverTemplateId: 'tpl_server_1',
        templateToken: 'tpt_plaintext',
        version: 1,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        rejectionReason: null,
      });
      await useCase.execute(baseInput());
      expect(commands.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          commandType: 'TEMPLATE_PUBLISH_REQUESTED',
          aggregateType: 'TEMPLATE',
        }),
        expect.anything(),
      );
    });

    it('marks the IntegrationCommand COMPLETED when the motor accepts', async () => {
      motor.publishTemplate.mockResolvedValue({
        accepted: true,
        serverTemplateId: 'tpl_server_1',
        templateToken: 'tpt_plaintext',
        version: 1,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        rejectionReason: null,
      });
      await useCase.execute(baseInput());
      expect(commands.update).toHaveBeenCalledWith(
        'command_row_1',
        expect.objectContaining({ status: 'COMPLETED' }),
        expect.anything(),
      );
    });

    it('marks the IntegrationCommand FAILED when the motor rejects', async () => {
      motor.publishTemplate.mockResolvedValue({
        accepted: false,
        serverTemplateId: null,
        templateToken: null,
        version: 1,
        status: 'FAILED',
        acceptedAt: null,
        rejectionReason: 'Motor rejected.',
      });
      await useCase.execute(baseInput());
      expect(commands.update).toHaveBeenCalledWith(
        'command_row_1',
        expect.objectContaining({ status: 'FAILED', lastError: 'Motor rejected.' }),
        expect.anything(),
      );
    });

    it('leaves the IntegrationCommand REQUESTED (never COMPLETED/FAILED) when the motor call itself throws — recoverable only by a manual retry', async () => {
      motor.publishTemplate.mockRejectedValue(new Error('network error'));
      await expect(useCase.execute(baseInput())).rejects.toThrow('network error');
      expect(commands.update).not.toHaveBeenCalled();
    });
  });
});
