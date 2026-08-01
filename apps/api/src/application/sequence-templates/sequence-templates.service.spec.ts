import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SequenceTemplateStepRepository } from '../../domain/sequence-template/sequence-template-step.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { SignaturesService } from '../signatures/signatures.service';
import { ExecutiveMailboxEligibilityService } from './executive-mailbox-eligibility.service';
import { SequenceTemplatesService } from './sequence-templates.service';

describe('SequenceTemplatesService', () => {
  let templates: jest.Mocked<
    Pick<SequenceTemplateRepository, 'findById' | 'findByOwner' | 'findByMailbox' | 'create' | 'update' | 'delete' | 'conditionalUpdateStatus'>
  >;
  let steps: jest.Mocked<Pick<SequenceTemplateStepRepository, 'findByTemplate' | 'findById' | 'create' | 'update' | 'deleteByTemplate'>>;
  let versions: jest.Mocked<
    Pick<SequenceTemplateVersionRepository, 'findByTemplate' | 'findLatestByTemplate' | 'findLatestAcceptedByTemplate' | 'findByServerTemplateId' | 'create' | 'update'>
  >;
  let executions: jest.Mocked<Pick<SequenceExecutionRepository, 'findByExecutive' | 'findAllByOrganization'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let eligibility: jest.Mocked<Pick<ExecutiveMailboxEligibilityService, 'requireEligible'>>;
  let mailboxesService: jest.Mocked<Pick<MailboxesService, 'getById'>>;
  let signatures: jest.Mocked<Pick<SignaturesService, 'getByMailbox'>>;
  let sanitizer: HtmlSanitizerService;
  let config: Pick<AppConfigService, 'signatureAssetAllowedImageHost' | 'signatureAssetAllowInsecureImageHost'>;
  let service: SequenceTemplatesService;

  const orgId = 'org_1';
  const executiveId = 'exec_1';
  const mailboxId = 'mailbox_1';

  beforeEach(() => {
    templates = {
      findById: jest.fn(),
      findByOwner: jest.fn().mockResolvedValue([]),
      findByMailbox: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      conditionalUpdateStatus: jest.fn(),
    };
    steps = { findByTemplate: jest.fn().mockResolvedValue([]), findById: jest.fn(), create: jest.fn(), update: jest.fn(), deleteByTemplate: jest.fn() };
    versions = {
      findByTemplate: jest.fn().mockResolvedValue([]),
      findLatestByTemplate: jest.fn().mockResolvedValue(null),
      findLatestAcceptedByTemplate: jest.fn().mockResolvedValue(null),
      findByServerTemplateId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    executions = { findByExecutive: jest.fn().mockResolvedValue([]), findAllByOrganization: jest.fn().mockResolvedValue([]) };
    audit = { record: jest.fn() };
    eligibility = { requireEligible: jest.fn().mockResolvedValue({ id: mailboxId, serverMailboxId: 'srv_1', email: 'ventas@empresa.cl' }) };
    mailboxesService = { getById: jest.fn().mockResolvedValue({ email: 'ventas@empresa.cl', clientName: 'Empresa Demostración', domainName: 'empresa.cl' }) };
    signatures = { getByMailbox: jest.fn().mockResolvedValue({ activeVersion: { htmlContent: '<p>Firma</p>' } }) };
    sanitizer = new HtmlSanitizerService();
    config = { signatureAssetAllowedImageHost: 'localhost', signatureAssetAllowInsecureImageHost: true };

    service = new SequenceTemplatesService(
      templates as unknown as SequenceTemplateRepository,
      steps as unknown as SequenceTemplateStepRepository,
      versions as unknown as SequenceTemplateVersionRepository,
      executions as unknown as SequenceExecutionRepository,
      audit as unknown as AuditLogRepository,
      eligibility as unknown as ExecutiveMailboxEligibilityService,
      mailboxesService as unknown as MailboxesService,
      signatures as unknown as SignaturesService,
      sanitizer,
      config as unknown as AppConfigService,
    );

    templates.create.mockImplementation(async (input) => ({
      id: 'tpl_1',
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      mailboxId: input.mailboxId,
      name: input.name,
      description: input.description ?? null,
      subjectTemplate: '',
      headerText: null,
      signatureHtml: input.signatureHtml,
      status: 'DRAFT',
      currentDraftVersion: 1,
      timezone: input.timezone,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      deletedAt: null,
    }));
    steps.create.mockImplementation(async (input) => ({
      id: `step_${input.stepNumber}`,
      organizationId: input.organizationId,
      templateId: input.templateId,
      stepNumber: input.stepNumber,
      name: input.name,
      enabled: true,
      subjectTemplate: '',
      headerHtml: null,
      headerText: null,
      bodyHtml: '',
      bodyText: '',
      delayValue: input.stepNumber === 1 ? 0 : 5,
      delayUnit: 'BUSINESS_DAYS',
      delayReference: input.stepNumber === 1 ? 'EXECUTION_START' : 'PREVIOUS_STEP',
      allowedWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      sendWindowStart: input.stepNumber === 1 ? '00:00' : '08:00',
      sendWindowEnd: '19:00',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    templates.findById.mockImplementation(async () => templates.create.mock.results[0]?.value ?? null);
  });

  describe('create — §1 (Fase 1.7) required, validated name', () => {
    it('uses the executive-provided name verbatim, trimmed', async () => {
      const detail = await service.create(orgId, executiveId, { mailboxId, name: '  Prospección Gerentes de RRHH  ' });
      expect(templates.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Prospección Gerentes de RRHH' }));
      expect(detail.name).toBe('Prospección Gerentes de RRHH');
    });

    it('rejects a name shorter than the minimum', async () => {
      await expect(service.create(orgId, executiveId, { mailboxId, name: 'Hi' })).rejects.toThrow(/al menos/);
      expect(templates.create).not.toHaveBeenCalled();
    });

    it('rejects a name that is only a version number', async () => {
      await expect(service.create(orgId, executiveId, { mailboxId, name: '3' })).rejects.toThrow(/número de versión/);
      await expect(service.create(orgId, executiveId, { mailboxId, name: 'Versión 3' })).rejects.toThrow(/número de versión/);
      await expect(service.create(orgId, executiveId, { mailboxId, name: 'v3' })).rejects.toThrow(/número de versión/);
      expect(templates.create).not.toHaveBeenCalled();
    });

    it('rejects a name already used by the same executive on the same cuenta', async () => {
      templates.findByMailbox.mockResolvedValue([
        { id: 'tpl_other', ownerUserId: executiveId, name: 'Prospección Gerentes de RRHH' } as any,
      ]);
      await expect(
        service.create(orgId, executiveId, { mailboxId, name: 'Prospección Gerentes de RRHH' }),
      ).rejects.toThrow(/Ya tienes una plantilla/);
      expect(templates.create).not.toHaveBeenCalled();
    });

    it('allows the same name on a different cuenta', async () => {
      templates.findByMailbox.mockResolvedValue([]); // findByMailbox scoped to THIS mailboxId only
      await expect(service.create(orgId, executiveId, { mailboxId, name: 'Prospección Gerentes de RRHH' })).resolves.toBeDefined();
    });

    it('allows the same name for a different executive on the same cuenta', async () => {
      templates.findByMailbox.mockResolvedValue([
        { id: 'tpl_other', ownerUserId: 'other_executive', name: 'Prospección Gerentes de RRHH' } as any,
      ]);
      await expect(service.create(orgId, executiveId, { mailboxId, name: 'Prospección Gerentes de RRHH' })).resolves.toBeDefined();
    });

    it('"Capacidades operativas del administrador" — an admin acting as ownerUserId creates a Plantilla identically to an executive (same method, no special-casing); it is scoped by ownerUserId like any other', async () => {
      templates.findByMailbox.mockResolvedValue([]);
      const adminActorId = 'admin_1';
      const detail = await service.create(orgId, adminActorId, { mailboxId, name: 'Plantilla del administrador' });
      expect(templates.create).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: adminActorId }));
      expect(detail.ownerUserId).toBe(adminActorId);
    });

    it('creates exactly 3 envíos automatically', async () => {
      await service.create(orgId, executiveId, { mailboxId, name: 'Prospección Gerentes de RRHH' });
      expect(steps.create).toHaveBeenCalledTimes(3);
      expect(steps.create).toHaveBeenCalledWith(expect.objectContaining({ stepNumber: 1 }));
      expect(steps.create).toHaveBeenCalledWith(expect.objectContaining({ stepNumber: 2 }));
      expect(steps.create).toHaveBeenCalledWith(expect.objectContaining({ stepNumber: 3 }));
    });

    it('Fase 2 (R2) — snapshots the mailbox\'s current signature into the new template\'s signatureHtml column once, for display/debugging only (never read back afterward — see getDetail)', async () => {
      await service.create(orgId, executiveId, { mailboxId, name: 'Prospección Gerentes de RRHH' });
      expect(signatures.getByMailbox).toHaveBeenCalledWith(orgId, mailboxId);
      expect(templates.create).toHaveBeenCalledWith(expect.objectContaining({ signatureHtml: '<p>Firma</p>' }));
    });

    it('a mailbox with no signature yet yields an empty (never undefined/null) snapshot', async () => {
      signatures.getByMailbox.mockRejectedValue(new Error('not found'));
      await service.create(orgId, executiveId, { mailboxId, name: 'Prospección Gerentes de RRHH' });
      expect(templates.create).toHaveBeenCalledWith(expect.objectContaining({ signatureHtml: '' }));
    });
  });

  describe('update / getDetail — Fase 2 (R2), a Plantilla has no independent signature anymore', () => {
    const existingTemplate = {
      id: 'tpl_1',
      organizationId: orgId,
      ownerUserId: executiveId,
      mailboxId,
      name: 'Prospección Gerentes de RRHH',
      subjectTemplate: 'Hola {contact_name}',
      signatureHtml: '<p>Firma anterior (columna sin usar)</p>',
      status: 'DRAFT',
      currentDraftVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };

    beforeEach(() => {
      templates.findById.mockResolvedValue(existingTemplate as any);
      templates.update.mockResolvedValue(existingTemplate as any);
    });

    it('update() no longer accepts a signatureHtml input at all — it is not part of UpdateSequenceTemplateInput', async () => {
      // @ts-expect-error — signatureHtml is intentionally not a valid key anymore.
      await service.update(orgId, executiveId, 'tpl_1', { subjectTemplate: 'Nuevo asunto', signatureHtml: '<p>Ignorada</p>' });
      const patch = templates.update.mock.calls[0][1];
      expect(patch).not.toHaveProperty('signatureHtml');
    });

    it('getDetail always resolves the mailbox\'s current live signature, ignoring the stored (now vestigial) column', async () => {
      signatures.getByMailbox.mockResolvedValue({ activeVersion: { htmlContent: '<p>Firma vigente de la cuenta</p>' } } as any);
      const detail = await service.getDetail(orgId, executiveId, 'tpl_1');
      expect(detail.signatureHtml).toBe('<p>Firma vigente de la cuenta</p>');
      expect(signatures.getByMailbox).toHaveBeenCalledWith(orgId, mailboxId);
    });

    it('two templates on the same mailbox reflect the exact same signature — there is only one to reflect', async () => {
      signatures.getByMailbox.mockResolvedValue({ activeVersion: { htmlContent: '<p>Firma compartida</p>' } } as any);
      const detailA = await service.getDetail(orgId, executiveId, 'tpl_1');
      const detailB = await service.getDetail(orgId, executiveId, 'tpl_1');
      expect(detailA.signatureHtml).toBe('<p>Firma compartida</p>');
      expect(detailB.signatureHtml).toBe('<p>Firma compartida</p>');
    });

    it('a mailbox with no signature yet resolves to an empty string, never throwing', async () => {
      signatures.getByMailbox.mockRejectedValue(new Error('not found'));
      const detail = await service.getDetail(orgId, executiveId, 'tpl_1');
      expect(detail.signatureHtml).toBe('');
    });
  });

  describe('updateStep — §2 (Fase 1.7) fixed BUSINESS_DAYS', () => {
    const template = {
      id: 'tpl_1',
      organizationId: orgId,
      ownerUserId: executiveId,
      mailboxId,
      name: 'Prospección Gerentes de RRHH',
      subjectTemplate: 'Hola {contact_name}',
      signatureHtml: '<p>Firma existente</p>',
      status: 'DRAFT',
      currentDraftVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };

    beforeEach(() => {
      templates.findById.mockResolvedValue(template as any);
      steps.findByTemplate.mockResolvedValue([
        { id: 'step_2', stepNumber: 2, headerText: null, bodyHtml: '<p>Cuerpo</p>', delayValue: 5, delayUnit: 'BUSINESS_DAYS' } as any,
      ]);
    });

    it('always persists delayUnit BUSINESS_DAYS, ignoring anything else a caller might still send', async () => {
      await service.updateStep(orgId, executiveId, 'tpl_1', 2, { delayValue: 5, delayUnit: 'CALENDAR_DAYS' } as any);
      expect(steps.update).toHaveBeenCalledWith('step_2', expect.objectContaining({ delayUnit: 'BUSINESS_DAYS' }));
    });

    it('rejects a delayValue below the minimum', async () => {
      await expect(service.updateStep(orgId, executiveId, 'tpl_1', 2, { delayValue: 0 })).rejects.toThrow(/entre 1 y 20/);
    });

    it('rejects a delayValue above the maximum', async () => {
      await expect(service.updateStep(orgId, executiveId, 'tpl_1', 2, { delayValue: 21 })).rejects.toThrow(/entre 1 y 20/);
    });

    it('rejects a non-integer delayValue', async () => {
      await expect(service.updateStep(orgId, executiveId, 'tpl_1', 2, { delayValue: 2.5 })).rejects.toThrow(/entero/);
    });

    it('accepts a delayValue at each boundary', async () => {
      await expect(service.updateStep(orgId, executiveId, 'tpl_1', 2, { delayValue: 1 })).resolves.toBeDefined();
      await expect(service.updateStep(orgId, executiveId, 'tpl_1', 2, { delayValue: 20 })).resolves.toBeDefined();
    });

    it('Fase 2 (R2), §15 — keeps an <img> pointing at the configured allowed asset host, over HTTP, since the mocked config allows insecure (simulated dev mode)', async () => {
      await service.updateStep(orgId, executiveId, 'tpl_1', 2, {
        bodyHtml: '<img src="http://localhost/uploads/email-body/org_1/exec_1/asset_1.png" alt="Logo">',
      });
      expect(steps.update).toHaveBeenCalledWith(
        'step_2',
        expect.objectContaining({ bodyHtml: expect.stringContaining('http://localhost/uploads/email-body/org_1/exec_1/asset_1.png') }),
      );
    });

    it('Fase 2 (R2), §15 — strips a <img> pointing at any other host in the body, same restriction as the signature', async () => {
      await service.updateStep(orgId, executiveId, 'tpl_1', 2, {
        bodyHtml: '<img src="https://evil.example.com/logo.png" alt="Logo">',
      });
      expect(steps.update).toHaveBeenCalledWith('step_2', expect.objectContaining({ bodyHtml: '' }));
    });
  });

  describe('deleteTemplate — §8-10', () => {
    function templateWithStatus(status: string) {
      return {
        id: 'tpl_1',
        organizationId: orgId,
        ownerUserId: executiveId,
        mailboxId,
        name: 'Prospección Gerentes de RRHH',
        status,
        archivedAt: null,
      };
    }

    it('hard-deletes a DRAFT template and its steps, with no server contact', async () => {
      templates.findById.mockResolvedValue(templateWithStatus('DRAFT') as any);
      await service.deleteTemplate(orgId, executiveId, 'tpl_1');
      expect(steps.deleteByTemplate).toHaveBeenCalledWith('tpl_1');
      expect(templates.delete).toHaveBeenCalledWith('tpl_1');
      expect(templates.update).not.toHaveBeenCalled();
    });

    it('hard-deletes a PUBLISH_FAILED template', async () => {
      templates.findById.mockResolvedValue(templateWithStatus('PUBLISH_FAILED') as any);
      await service.deleteTemplate(orgId, executiveId, 'tpl_1');
      expect(templates.delete).toHaveBeenCalledWith('tpl_1');
    });

    it('logically deletes an ARCHIVED template, preserving history', async () => {
      templates.findById.mockResolvedValue(templateWithStatus('ARCHIVED') as any);
      await service.deleteTemplate(orgId, executiveId, 'tpl_1');
      expect(templates.delete).not.toHaveBeenCalled();
      expect(templates.update).toHaveBeenCalledWith('tpl_1', expect.objectContaining({ deletedAt: expect.any(Date) }));
    });

    it('blocks deleting a PUBLISHED template with active Gestiones', async () => {
      templates.findById.mockResolvedValue(templateWithStatus('PUBLISHED') as any);
      executions.findAllByOrganization.mockResolvedValue([
        { templateId: 'tpl_1', status: 'ACCEPTED' } as any,
      ]);
      await expect(service.deleteTemplate(orgId, executiveId, 'tpl_1')).rejects.toThrow(/Gestiones activas/);
      expect(templates.update).not.toHaveBeenCalled();
      expect(templates.delete).not.toHaveBeenCalled();
    });

    it('allows deleting a PUBLISHED template with zero active Gestiones, retiring it logically', async () => {
      templates.findById.mockResolvedValue(templateWithStatus('PUBLISHED') as any);
      executions.findAllByOrganization.mockResolvedValue([
        { templateId: 'tpl_1', status: 'COMPLETED' } as any,
        { templateId: 'tpl_1', status: 'FAILED' } as any,
        { templateId: 'other_tpl', status: 'ACCEPTED' } as any,
      ]);
      await service.deleteTemplate(orgId, executiveId, 'tpl_1');
      expect(templates.update).toHaveBeenCalledWith(
        'tpl_1',
        expect.objectContaining({ status: 'ARCHIVED', deletedAt: expect.any(Date) }),
      );
    });

    it('never deletes a template that is mid-publish', async () => {
      templates.findById.mockResolvedValue(templateWithStatus('PUBLISHING') as any);
      await expect(service.deleteTemplate(orgId, executiveId, 'tpl_1')).rejects.toThrow(/publicando/);
    });
  });

  describe('canDeleteTemplate — §10 preflight', () => {
    it('reports the active-executions count and whether deletion is allowed', async () => {
      templates.findById.mockResolvedValue({ id: 'tpl_1', organizationId: orgId, ownerUserId: executiveId } as any);
      executions.findAllByOrganization.mockResolvedValue([
        { templateId: 'tpl_1', status: 'RUNNING' } as any,
        { templateId: 'tpl_1', status: 'SUBMITTING' } as any,
      ]);
      const result = await service.canDeleteTemplate(orgId, executiveId, 'tpl_1');
      expect(result).toEqual({ canDelete: false, activeExecutionsCount: 2 });
    });
  });

  describe('validateForPublish — §9', () => {
    const template = {
      id: 'tpl_1',
      organizationId: orgId,
      ownerUserId: executiveId,
      mailboxId,
      name: 'Plantilla - Empresa Demostración',
      subjectTemplate: 'Hola {contact_name}',
      headerText: null,
      status: 'DRAFT',
      currentDraftVersion: 1,
      timezone: 'America/Santiago',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      deletedAt: null,
    };

    function fullStep(stepNumber: 1 | 2 | 3, overrides: Record<string, unknown> = {}) {
      return {
        id: `step_${stepNumber}`,
        organizationId: orgId,
        templateId: 'tpl_1',
        stepNumber,
        headerText: null,
        bodyHtml: '<p>Cuerpo</p>',
        bodyText: 'Cuerpo',
        delayValue: stepNumber === 1 ? 0 : 5,
        delayUnit: 'BUSINESS_DAYS',
        delayReference: stepNumber === 1 ? 'EXECUTION_START' : 'PREVIOUS_STEP',
        allowedWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        sendWindowStart: stepNumber === 1 ? '00:00' : '08:00',
        sendWindowEnd: '19:00',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    beforeEach(() => {
      templates.findById.mockResolvedValue(template as any);
      steps.findByTemplate.mockResolvedValue([fullStep(1), fullStep(2), fullStep(3)] as any);
    });

    it('is valid when subject, all 3 envíos and the mailbox are all fine', async () => {
      const result = await service.validateForPublish(orgId, executiveId, 'tpl_1');
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('reports a missing subject', async () => {
      templates.findById.mockResolvedValue({ ...template, subjectTemplate: '' } as any);
      const result = await service.validateForPublish(orgId, executiveId, 'tpl_1');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('asunto'))).toBe(true);
    });

    it('reports a missing envío body', async () => {
      steps.findByTemplate.mockResolvedValue([fullStep(1), fullStep(2, { bodyHtml: '' }), fullStep(3)] as any);
      const result = await service.validateForPublish(orgId, executiveId, 'tpl_1');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Envío 2'))).toBe(true);
    });

    it('reports an invalid variable in an envío header', async () => {
      steps.findByTemplate.mockResolvedValue([
        fullStep(1, { headerText: 'Hola {nombre invalido' }),
        fullStep(2),
        fullStep(3),
      ] as any);
      const result = await service.validateForPublish(orgId, executiveId, 'tpl_1');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Envío 1') && e.includes('header'))).toBe(true);
    });

    it('reports a mailbox eligibility failure as a validation error instead of throwing', async () => {
      eligibility.requireEligible.mockRejectedValue(new Error('La cuenta no está en condiciones técnicas de enviar.'));
      const result = await service.validateForPublish(orgId, executiveId, 'tpl_1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('La cuenta no está en condiciones técnicas de enviar.');
    });
  });
});
