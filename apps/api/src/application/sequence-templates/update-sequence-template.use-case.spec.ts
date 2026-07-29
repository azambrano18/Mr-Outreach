import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { SequenceTemplateMotorPort } from '../../domain/sequence-template-motor/sequence-template-motor-port';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ExecutiveMailboxEligibilityService } from './executive-mailbox-eligibility.service';
import { SequenceTemplatesService } from './sequence-templates.service';
import { UpdateSequenceTemplateUseCase } from './update-sequence-template.use-case';

describe('UpdateSequenceTemplateUseCase', () => {
  let templates: jest.Mocked<Pick<SequenceTemplateRepository, 'conditionalUpdateStatus' | 'update'>>;
  let versions: jest.Mocked<Pick<SequenceTemplateVersionRepository, 'findLatestByTemplate' | 'create' | 'update'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let motor: jest.Mocked<Pick<SequenceTemplateMotorPort, 'updateTemplate'>>;
  let templatesService: jest.Mocked<
    Pick<SequenceTemplatesService, 'requireOwned' | 'getStepsForPublish' | 'getSignatureHtmlForMailbox' | 'validateForPublish'>
  >;
  let eligibility: jest.Mocked<Pick<ExecutiveMailboxEligibilityService, 'requireEligible'>>;
  let secrets: jest.Mocked<Pick<SecretEncryptionService, 'encrypt' | 'decrypt'>>;
  let useCase: UpdateSequenceTemplateUseCase;

  const orgId = 'org_1';
  const templateId = 'tpl_1';
  const actorId = 'exec_1';

  const publishedTemplate = {
    id: templateId,
    organizationId: orgId,
    ownerUserId: actorId,
    mailboxId: 'mailbox_1',
    name: 'Plantilla - Empresa Demostración',
    subjectTemplate: 'Hola {contact_name}',
    status: 'PUBLISHED',
    currentDraftVersion: 2,
    timezone: 'America/Santiago',
  };
  const mailbox = { id: 'mailbox_1', serverMailboxId: 'srv_1', email: 'ventas@empresa.cl' };
  const currentAcceptedVersion = {
    id: 'version_1',
    versionNumber: 1,
    status: 'ACCEPTED',
    serverTemplateId: 'tpl_server_1',
  };

  function validStep(stepNumber: 1 | 2 | 3) {
    return {
      id: `step_${stepNumber}`,
      organizationId: orgId,
      templateId,
      stepNumber,
      headerText: null,
      bodyHtml: `<p>Cuerpo del envío ${stepNumber}.</p>`,
      bodyText: `Cuerpo del envío ${stepNumber}.`,
      delayValue: stepNumber === 1 ? 0 : 5,
      delayUnit: 'BUSINESS_DAYS' as const,
      delayReference: stepNumber === 1 ? ('EXECUTION_START' as const) : ('PREVIOUS_STEP' as const),
      allowedWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const,
      sendWindowStart: stepNumber === 1 ? '00:00' : '08:00',
      sendWindowEnd: '19:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  function baseInput() {
    return { organizationId: orgId, templateId, actorId, idempotencyKey: 'idem_1' };
  }

  beforeEach(() => {
    templates = { conditionalUpdateStatus: jest.fn().mockResolvedValue(1), update: jest.fn().mockResolvedValue(publishedTemplate) };
    const createdVersion = {
      id: 'version_2',
      templateId,
      versionNumber: 2,
      name: publishedTemplate.name,
      mailboxId: publishedTemplate.mailboxId,
      timezone: publishedTemplate.timezone,
      subjectTemplate: publishedTemplate.subjectTemplate,
      signatureHtml: '<p>Firma</p>',
      variables: [],
      steps: [],
      status: 'REQUESTED',
      serverTemplateId: null,
      templateTokenCiphertext: null,
      acceptedAt: null,
      lastPublishCommandId: 'cmd_1',
      lastError: null,
      previousVersionNumber: 1,
      effectiveScope: null,
      affectedExecutions: null,
      affectedPendingJobs: null,
      unchangedSentJobs: null,
      processingJobsNotChanged: null,
      appliedAt: null,
      createdBy: actorId,
      createdAt: new Date(),
    };
    versions = {
      findLatestByTemplate: jest.fn().mockResolvedValue(currentAcceptedVersion),
      create: jest.fn().mockResolvedValue(createdVersion),
      update: jest.fn().mockImplementation(async (id, input) => ({ ...createdVersion, id, ...input })),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    motor = { updateTemplate: jest.fn() };
    templatesService = {
      requireOwned: jest.fn().mockResolvedValue(publishedTemplate),
      getStepsForPublish: jest.fn().mockResolvedValue([validStep(1), validStep(2), validStep(3)]),
      getSignatureHtmlForMailbox: jest.fn().mockResolvedValue('<p>Firma</p>'),
      validateForPublish: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
    };
    eligibility = { requireEligible: jest.fn().mockResolvedValue(mailbox) };
    secrets = { encrypt: jest.fn().mockReturnValue('enc(token)'), decrypt: jest.fn() };

    useCase = new UpdateSequenceTemplateUseCase(
      templates as unknown as SequenceTemplateRepository,
      versions as unknown as SequenceTemplateVersionRepository,
      audit as unknown as AuditLogRepository,
      motor as unknown as SequenceTemplateMotorPort,
      templatesService as unknown as SequenceTemplatesService,
      eligibility as unknown as ExecutiveMailboxEligibilityService,
      secrets as unknown as SecretEncryptionService,
    );
  });

  it('rejects updating a template that is not PUBLISHED', async () => {
    templatesService.requireOwned.mockResolvedValue({ ...publishedTemplate, status: 'DRAFT' } as any);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
    expect(motor.updateTemplate).not.toHaveBeenCalled();
  });

  it('rejects when there is no ACCEPTED published version yet', async () => {
    versions.findLatestByTemplate.mockResolvedValue({ ...currentAcceptedVersion, status: 'FAILED' } as any);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects with validation errors when the content is not ready', async () => {
    templatesService.validateForPublish.mockResolvedValue({ valid: false, errors: ['Envío 2: el cuerpo del correo es obligatorio.'] });
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(BadRequestException);
    expect(motor.updateTemplate).not.toHaveBeenCalled();
  });

  it('rejects a concurrent update attempt (already PUBLISHING)', async () => {
    templates.conditionalUpdateStatus.mockResolvedValue(0);
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
    expect(motor.updateTemplate).not.toHaveBeenCalled();
  });

  it('applies successfully: creates a new version chained to the previous one, sends SEQUENCE_TEMPLATE_UPDATE, and keeps the template PUBLISHED', async () => {
    motor.updateTemplate.mockResolvedValue({
      accepted: true,
      serverTemplateId: 'tpl_server_1',
      previousVersion: 1,
      newVersion: 2,
      templateToken: 'tpt_plaintext',
      status: 'APPLIED',
      effectiveScope: 'FUTURE_UNSENT_JOBS',
      affectedExecutions: 3,
      affectedPendingJobs: 12,
      unchangedSentJobs: 40,
      processingJobsNotChanged: 2,
      appliedAt: new Date(),
      rejectionReason: null,
    });

    const result = await useCase.execute(baseInput());

    expect(versions.create).toHaveBeenCalledWith(expect.objectContaining({ previousVersionNumber: 1 }));
    expect(motor.updateTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ currentVersion: 1, newVersion: 2, serverTemplateId: 'tpl_server_1', effectiveScope: 'FUTURE_UNSENT_JOBS' }),
    );
    expect(templates.update).toHaveBeenCalledWith(templateId, { status: 'PUBLISHED' });
    expect(result.version.status).toBe('ACCEPTED');
    expect(result.version.affectedExecutions).toBe(3);
    expect(result.version.previousVersionNumber).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sequence_template.update_applied' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sequence_template.active_executions_affected' }));
  });

  it('keeps the template PUBLISHED (never PUBLISH_FAILED) and marks only the new version FAILED when the motor rejects the update', async () => {
    motor.updateTemplate.mockResolvedValue({
      accepted: false,
      serverTemplateId: null,
      previousVersion: 1,
      newVersion: 2,
      templateToken: null,
      status: 'FAILED',
      effectiveScope: 'FUTURE_UNSENT_JOBS',
      affectedExecutions: null,
      affectedPendingJobs: null,
      unchangedSentJobs: null,
      processingJobsNotChanged: null,
      appliedAt: null,
      rejectionReason: 'Motor rejected the update.',
    });

    const result = await useCase.execute(baseInput());

    expect(templates.update).toHaveBeenCalledWith(templateId, { status: 'PUBLISHED' });
    expect(templates.update).not.toHaveBeenCalledWith(templateId, { status: 'PUBLISH_FAILED' });
    expect(result.version.status).toBe('FAILED');
    expect(secrets.encrypt).not.toHaveBeenCalled();
  });

  it('keeps the template PUBLISHED when the mailbox eligibility check throws during the update', async () => {
    eligibility.requireEligible.mockRejectedValue(new ConflictException('no eligible'));
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(ConflictException);
    expect(templates.update).toHaveBeenCalledWith(templateId, { status: 'PUBLISHED' });
  });
});
