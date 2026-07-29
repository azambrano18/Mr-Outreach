import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { UserRepository } from '../../domain/user/user.repository';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { ProspectImportsService } from '../prospect-imports/prospect-imports.service';
import { ExecutiveMailboxEligibilityService } from '../sequence-templates/executive-mailbox-eligibility.service';
import { SequenceExecutionsService } from './sequence-executions.service';

describe('SequenceExecutionsService', () => {
  let executions: jest.Mocked<
    Pick<SequenceExecutionRepository, 'create' | 'findByExecutive' | 'findAllByOrganization' | 'findById' | 'update' | 'delete'>
  >;
  let templates: jest.Mocked<Pick<SequenceTemplateRepository, 'findById'>>;
  let templateVersions: jest.Mocked<Pick<SequenceTemplateVersionRepository, 'findLatestAcceptedByTemplate' | 'findById'>>;
  let users: jest.Mocked<Pick<UserRepository, 'findById'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let eligibility: jest.Mocked<Pick<ExecutiveMailboxEligibilityService, 'requireEligible'>>;
  let mailboxesService: jest.Mocked<Pick<MailboxesService, 'getById'>>;
  let prospectImports: jest.Mocked<Pick<ProspectImportsService, 'getImportForExecution' | 'deleteForExecution'>>;
  let service: SequenceExecutionsService;

  const orgId = 'org_1';
  const executiveId = 'exec_1';
  const mailboxId = 'mailbox_1';
  const templateId = 'tpl_1';

  const publishedTemplate = { id: templateId, organizationId: orgId, ownerUserId: executiveId, mailboxId, status: 'PUBLISHED', timezone: 'America/Santiago' };
  const acceptedVersion = { id: 'version_1', versionNumber: 1, status: 'ACCEPTED' };
  const mailbox = { id: mailboxId };

  beforeEach(() => {
    executions = {
      create: jest.fn(),
      findByExecutive: jest.fn().mockResolvedValue([]),
      findAllByOrganization: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    templates = { findById: jest.fn().mockResolvedValue(publishedTemplate) };
    templateVersions = { findLatestAcceptedByTemplate: jest.fn().mockResolvedValue(acceptedVersion), findById: jest.fn() };
    users = { findById: jest.fn() };
    audit = { record: jest.fn() };
    eligibility = { requireEligible: jest.fn().mockResolvedValue(mailbox) };
    mailboxesService = { getById: jest.fn().mockResolvedValue({ email: 'ventas@empresa.cl', clientName: null, domainName: null }) };
    prospectImports = { getImportForExecution: jest.fn().mockResolvedValue(null), deleteForExecution: jest.fn().mockResolvedValue(undefined) };

    service = new SequenceExecutionsService(
      executions as unknown as SequenceExecutionRepository,
      templates as unknown as SequenceTemplateRepository,
      templateVersions as unknown as SequenceTemplateVersionRepository,
      users as unknown as UserRepository,
      audit as unknown as AuditLogRepository,
      eligibility as unknown as ExecutiveMailboxEligibilityService,
      mailboxesService as unknown as MailboxesService,
      prospectImports as unknown as ProspectImportsService,
    );

    executions.create.mockImplementation(async (input) => ({
      id: 'run_1',
      organizationId: input.organizationId,
      executiveId: input.executiveId,
      mailboxId: input.mailboxId,
      templateId: input.templateId,
      templateVersionId: input.templateVersionId,
      name: null,
      timezone: input.timezone,
      status: 'DRAFT',
      prospectImportId: null,
      requestedAt: null,
      receivedAt: null,
      estimatedStartAt: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      serverStatus: null,
      currentStepNumber: null,
      sentCount: null,
      pendingCount: null,
      failedCount: null,
      receivedProspects: null,
      acceptedProspects: null,
      rejectedProspects: null,
      initialProspectState: null,
      lastSyncedAt: null,
      lastError: null,
      serverExecutionId: null,
      executionTokenCiphertext: null,
      lastSubmissionIdempotencyKey: null,
      createdBy: input.createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  it('rejects a template owned by a different executive', async () => {
    templates.findById.mockResolvedValue({ ...publishedTemplate, ownerUserId: 'someone_else' } as any);
    await expect(service.create(orgId, executiveId, { mailboxId, templateId })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a template belonging to a different mailbox than the one selected', async () => {
    templates.findById.mockResolvedValue({ ...publishedTemplate, mailboxId: 'other_mailbox' } as any);
    await expect(service.create(orgId, executiveId, { mailboxId, templateId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a template that is not PUBLISHED', async () => {
    templates.findById.mockResolvedValue({ ...publishedTemplate, status: 'DRAFT' } as any);
    await expect(service.create(orgId, executiveId, { mailboxId, templateId })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when there is no ACCEPTED version at all (e.g. only a FAILED publish attempt exists)', async () => {
    templateVersions.findLatestAcceptedByTemplate.mockResolvedValue(null);
    await expect(service.create(orgId, executiveId, { mailboxId, templateId })).rejects.toBeInstanceOf(ConflictException);
  });

  it('§5 — a later FAILED publish attempt never blocks creating a new Gestión against the still-active previously-accepted version', async () => {
    templateVersions.findLatestAcceptedByTemplate.mockResolvedValue(acceptedVersion as any);
    await expect(service.create(orgId, executiveId, { mailboxId, templateId })).resolves.toBeDefined();
    expect(templateVersions.findLatestAcceptedByTemplate).toHaveBeenCalledWith(templateId);
  });

  it('re-validates mailbox eligibility (fail-closed) before creating the execution', async () => {
    await service.create(orgId, executiveId, { mailboxId, templateId });
    expect(eligibility.requireEligible).toHaveBeenCalledWith(orgId, executiveId, mailboxId);
  });

  it('creates a nameless DRAFT execution against the template published version, without asking for any date, and audits it', async () => {
    const result = await service.create(orgId, executiveId, { mailboxId, templateId });
    expect(executions.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, executiveId, mailboxId, templateId, templateVersionId: acceptedVersion.id }),
    );
    expect(executions.create).toHaveBeenCalledWith(expect.not.objectContaining({ startAt: expect.anything() }));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sequence_execution.draft_created', entityType: 'SequenceExecution' }),
    );
    expect(result.status).toBe('DRAFT');
    expect(result.name).toBeNull();
  });

  it('"Capacidades operativas del administrador" — an admin acting as executiveId creates a Gestión identically to an executive (same method, no special-casing); scoped by executiveId like any other', async () => {
    const adminActorId = 'admin_1';
    templates.findById.mockResolvedValue({ ...publishedTemplate, ownerUserId: adminActorId } as any);
    const result = await service.create(orgId, adminActorId, { mailboxId, templateId });
    expect(executions.create).toHaveBeenCalledWith(expect.objectContaining({ executiveId: adminActorId }));
    expect(result.status).toBe('DRAFT');
  });

  describe('updateDraft/deleteDraft — §12', () => {
    const draftExecution = {
      id: 'run_1',
      organizationId: orgId,
      executiveId,
      mailboxId,
      templateId,
      templateVersionId: acceptedVersion.id,
      name: null,
      timezone: 'America/Santiago',
      status: 'DRAFT',
      prospectImportId: null,
      requestedAt: null,
      receivedAt: null,
      estimatedStartAt: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      serverStatus: null,
      currentStepNumber: null,
      sentCount: null,
      pendingCount: null,
      failedCount: null,
      receivedProspects: null,
      acceptedProspects: null,
      rejectedProspects: null,
      initialProspectState: null,
      lastSyncedAt: null,
      lastError: null,
      serverExecutionId: null,
      executionTokenCiphertext: null,
      lastSubmissionIdempotencyKey: null,
      createdBy: executiveId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      executions.findById.mockResolvedValue(draftExecution as any);
      executions.update.mockImplementation(async (id, input) => ({ ...draftExecution, ...input, id }) as any);
    });

    it('rejects editing a Gestión that is no longer DRAFT', async () => {
      executions.findById.mockResolvedValue({ ...draftExecution, status: 'ACCEPTED' } as any);
      await expect(service.updateDraft(orgId, executiveId, 'run_1', { templateId: 'tpl_2' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('drops the existing prospect mapping when the template changes', async () => {
      templates.findById.mockResolvedValue({ ...publishedTemplate, id: 'tpl_2' } as any);
      await service.updateDraft(orgId, executiveId, 'run_1', { templateId: 'tpl_2' });
      expect(prospectImports.deleteForExecution).toHaveBeenCalledWith('run_1');
    });

    it('does not touch the mapping when nothing changes', async () => {
      await service.updateDraft(orgId, executiveId, 'run_1', {});
      expect(prospectImports.deleteForExecution).not.toHaveBeenCalled();
    });

    it('rejects deleting a Gestión that is no longer DRAFT', async () => {
      executions.findById.mockResolvedValue({ ...draftExecution, status: 'ACCEPTED' } as any);
      await expect(service.deleteDraft(orgId, executiveId, 'run_1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes the Gestión and its prospect import, and audits it, without contacting Railway', async () => {
      await service.deleteDraft(orgId, executiveId, 'run_1');
      expect(prospectImports.deleteForExecution).toHaveBeenCalledWith('run_1');
      expect(executions.delete).toHaveBeenCalledWith('run_1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence_execution.draft_deleted', entityType: 'SequenceExecution', entityId: 'run_1' }),
      );
    });
  });
});
