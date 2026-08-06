import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceExecution } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { fullName } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  AUDIT_LOG_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  SEQUENCE_TEMPLATE_REPOSITORY,
  SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { ExecutiveMailboxEligibilityService } from '../sequence-templates/executive-mailbox-eligibility.service';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { ProspectImportsService } from '../prospect-imports/prospect-imports.service';
import { computeExecutionControlCapabilities } from './execution-control-capabilities';
import { SequenceExecutionSummary } from './sequence-executions.types';

export interface CreateSequenceExecutionInput {
  mailboxId: string;
  templateId: string;
}

/** §12 — everything an executive may still change while a Gestión is DRAFT. There is no start date/time here — it no longer exists anywhere in the Gestión lifecycle. */
export interface UpdateDraftSequenceExecutionInput {
  mailboxId?: string;
  templateId?: string;
}

@Injectable()
export class SequenceExecutionsService {
  constructor(
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(SEQUENCE_TEMPLATE_REPOSITORY) private readonly templates: SequenceTemplateRepository,
    @Inject(SEQUENCE_TEMPLATE_VERSION_REPOSITORY) private readonly templateVersions: SequenceTemplateVersionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    private readonly eligibility: ExecutiveMailboxEligibilityService,
    private readonly mailboxesService: MailboxesService,
    private readonly prospectImports: ProspectImportsService,
  ) {}

  /**
   * §1 — creates the DRAFT Gestión as soon as the executive picks an
   * account + a published Plantilla; no date/time is ever asked for here
   * or anywhere later. The name stays null until "Iniciar gestión"
   * actually sends the command (§3).
   */
  async create(organizationId: string, executiveId: string, input: CreateSequenceExecutionInput): Promise<SequenceExecutionSummary> {
    const mailbox = await this.eligibility.requireEligible(organizationId, executiveId, input.mailboxId);
    const { template, version } = await this.requirePublishedTemplate(organizationId, executiveId, input.templateId, mailbox.id);

    const execution = await this.executions.create({
      organizationId,
      executiveId,
      mailboxId: mailbox.id,
      templateId: template.id,
      templateVersionId: version.id,
      timezone: template.timezone,
      createdBy: executiveId,
    });

    await this.audit.record({
      organizationId,
      actorId: executiveId,
      action: 'sequence_execution.draft_created',
      entityType: 'SequenceExecution',
      entityId: execution.id,
      metadata: { templateId: template.id, templateVersionId: version.id, mailboxId: mailbox.id },
    });

    return this.toSummary(execution);
  }

  /**
   * §12 — only while DRAFT: the executive may still change the template
   * and (while still assigned) the account. Changing either drops any
   * existing column mapping (its required variables may differ) so the
   * executive is forced to re-map before starting.
   */
  async updateDraft(
    organizationId: string,
    executiveId: string,
    id: string,
    input: UpdateDraftSequenceExecutionInput,
  ): Promise<SequenceExecutionSummary> {
    const execution = await this.requireOwned(organizationId, executiveId, id);
    if (execution.status !== 'DRAFT') {
      throw new ConflictException('Esta gestión ya fue enviada y no se puede editar.');
    }

    const nextMailboxId = input.mailboxId ?? execution.mailboxId;
    const nextTemplateId = input.templateId ?? execution.templateId;
    const templateOrMailboxChanged = nextMailboxId !== execution.mailboxId || nextTemplateId !== execution.templateId;

    const mailbox = await this.eligibility.requireEligible(organizationId, executiveId, nextMailboxId);
    const { template, version } = await this.requirePublishedTemplate(organizationId, executiveId, nextTemplateId, mailbox.id);

    if (templateOrMailboxChanged) {
      // The previously-mapped columns may no longer satisfy the new template's required variables.
      await this.prospectImports.deleteForExecution(id);
    }

    const updated = await this.executions.update(id, {
      mailboxId: mailbox.id,
      templateId: template.id,
      templateVersionId: version.id,
      timezone: template.timezone,
    });

    await this.audit.record({
      organizationId,
      actorId: executiveId,
      action: 'sequence_execution.draft_updated',
      entityType: 'SequenceExecution',
      entityId: id,
      metadata: { mailboxId: mailbox.id, templateId: template.id, templateVersionId: version.id, mappingReset: templateOrMailboxChanged },
    });

    return this.toSummary(updated);
  }

  /**
   * §12 — only while DRAFT: removes the Gestión, its temp import file and
   * mapping, and any otherwise-unused imported rows. Never contacts
   * Railway — a Gestión already submitted/queued cannot be deleted here.
   */
  async deleteDraft(organizationId: string, executiveId: string, id: string): Promise<void> {
    const execution = await this.requireOwned(organizationId, executiveId, id);
    if (execution.status !== 'DRAFT') {
      throw new ConflictException('Esta gestión ya fue enviada al servidor y no se puede eliminar.');
    }

    await this.audit.record({
      organizationId,
      actorId: executiveId,
      action: 'sequence_execution.draft_deleted',
      entityType: 'SequenceExecution',
      entityId: id,
      metadata: { templateId: execution.templateId, mailboxId: execution.mailboxId },
    });

    await this.prospectImports.deleteForExecution(id);
    await this.executions.delete(id);
  }

  private async requirePublishedTemplate(organizationId: string, executiveId: string, templateId: string, mailboxId: string) {
    const template = await this.templates.findById(templateId);
    if (!template || template.organizationId !== organizationId) {
      throw new NotFoundException('Plantilla no encontrada.');
    }
    if (template.ownerUserId !== executiveId) {
      throw new NotFoundException('Plantilla no encontrada.');
    }
    if (template.mailboxId !== mailboxId) {
      throw new BadRequestException('La plantilla seleccionada pertenece a otra cuenta de correo.');
    }
    if (template.status !== 'PUBLISHED') {
      throw new ConflictException('Solo se pueden usar plantillas publicadas para iniciar una gestión.');
    }

    // §5 (consolidación contractual) — the latest ACCEPTED version, never merely the latest
    // attempt: a later FAILED publish must never block starting a new Gestión against the
    // still-active previously-accepted version.
    const version = await this.templateVersions.findLatestAcceptedByTemplate(template.id);
    if (!version) {
      throw new ConflictException('Esta plantilla no tiene una versión publicada aceptada por el servidor.');
    }

    return { template, version };
  }

  async listOwn(organizationId: string, executiveId: string): Promise<SequenceExecutionSummary[]> {
    const rows = await this.executions.findByExecutive(organizationId, executiveId);
    return Promise.all(rows.map((row) => this.toSummary(row)));
  }

  async listAllForOrganization(organizationId: string, actorPermissionKeys: readonly string[] = []): Promise<SequenceExecutionSummary[]> {
    const rows = await this.executions.findAllByOrganization(organizationId);
    return Promise.all(rows.map((row) => this.toSummary(row, actorPermissionKeys)));
  }

  async getOwned(organizationId: string, executiveId: string, id: string): Promise<SequenceExecutionSummary> {
    const execution = await this.requireOwned(organizationId, executiveId, id);
    return this.toSummary(execution);
  }

  /**
   * `actorPermissionKeys` drives `controlCapabilities` on the returned
   * summary (§2 — the Monitor detail's authoritative canPause/canResume/
   * canStop/canRestart). Only the admin-facing read paths pass it; every
   * other caller (POST action responses, the executive's own view) omits
   * it and gets every capability back as `false`, which those callers
   * never read.
   */
  async getAny(organizationId: string, id: string, actorPermissionKeys: readonly string[] = []): Promise<SequenceExecutionSummary> {
    const execution = await this.executions.findById(id);
    if (!execution || execution.organizationId !== organizationId) {
      throw new NotFoundException('Gestión no encontrada.');
    }
    return this.toSummary(execution, actorPermissionKeys);
  }

  async requireOwned(organizationId: string, executiveId: string, id: string): Promise<SequenceExecution> {
    const execution = await this.executions.findById(id);
    if (!execution || execution.organizationId !== organizationId || execution.executiveId !== executiveId) {
      throw new NotFoundException('Gestión no encontrada.');
    }
    return execution;
  }

  private async toSummary(execution: SequenceExecution, actorPermissionKeys: readonly string[] = []): Promise<SequenceExecutionSummary> {
    const [mailbox, template, version, executive, prospectImport] = await Promise.all([
      this.mailboxesService.getById(execution.organizationId, execution.mailboxId).catch(() => null),
      this.templates.findById(execution.templateId),
      this.templateVersions.findById(execution.templateVersionId),
      this.users.findById(execution.executiveId),
      this.prospectImports.getImportForExecution(execution.id),
    ]);

    return {
      id: execution.id,
      organizationId: execution.organizationId,
      executiveId: execution.executiveId,
      executiveName: executive ? fullName(executive) : '—',
      mailboxId: execution.mailboxId,
      mailboxEmail: mailbox?.email ?? '',
      clientName: mailbox?.clientName ?? null,
      domainName: mailbox?.domainName ?? null,
      templateId: execution.templateId,
      templateName: template?.name ?? '—',
      templateVersionId: execution.templateVersionId,
      templateVersionNumber: version?.versionNumber ?? 0,
      name: execution.name,
      timezone: execution.timezone,
      status: execution.status,
      requestedAt: execution.requestedAt ? execution.requestedAt.toISOString() : null,
      receivedAt: execution.receivedAt ? execution.receivedAt.toISOString() : null,
      estimatedStartAt: execution.estimatedStartAt ? execution.estimatedStartAt.toISOString() : null,
      startedAt: execution.startedAt ? execution.startedAt.toISOString() : null,
      completedAt: execution.completedAt ? execution.completedAt.toISOString() : null,
      failedAt: execution.failedAt ? execution.failedAt.toISOString() : null,
      serverStatus: execution.serverStatus,
      currentStepNumber: execution.currentStepNumber,
      sentCount: execution.sentCount,
      pendingCount: execution.pendingCount,
      failedCount: execution.failedCount,
      receivedProspects: execution.receivedProspects,
      acceptedProspects: execution.acceptedProspects,
      rejectedProspects: execution.rejectedProspects,
      initialProspectState: execution.initialProspectState,
      prospectCount: prospectImport?.validRows ?? null,
      lastSyncedAt: execution.lastSyncedAt ? execution.lastSyncedAt.toISOString() : null,
      lastError: execution.lastError,
      serverExecutionId: execution.serverExecutionId,
      pausedAt: execution.pausedAt ? execution.pausedAt.toISOString() : null,
      resumedAt: execution.resumedAt ? execution.resumedAt.toISOString() : null,
      stoppedAt: execution.stoppedAt ? execution.stoppedAt.toISOString() : null,
      stopReason: execution.stopReason,
      executionAttempt: execution.executionAttempt,
      previousExecutionId: execution.previousExecutionId,
      createdAt: execution.createdAt.toISOString(),
      updatedAt: execution.updatedAt.toISOString(),
      controlCapabilities: computeExecutionControlCapabilities(execution.status, actorPermissionKeys),
    };
  }
}
