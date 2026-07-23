import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { validateTemplateVariables } from '@outreach/validation';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Template, TemplateStatus } from '../../domain/template/template.entity';
import { TemplateRepository } from '../../domain/template/template.repository';
import { AUDIT_LOG_REPOSITORY, TEMPLATE_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { CreateTemplatePayload, TemplateSummary, UpdateTemplatePayload } from './templates.types';

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(TEMPLATE_REPOSITORY) private readonly templates: TemplateRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  async list(organizationId: string): Promise<TemplateSummary[]> {
    const rows = await this.templates.findAll(organizationId);
    return rows.map((row) => this.toSummary(row));
  }

  async getById(organizationId: string, templateId: string): Promise<TemplateSummary> {
    const template = await this.getOwnedTemplate(organizationId, templateId);
    return this.toSummary(template);
  }

  async create(
    organizationId: string,
    input: CreateTemplatePayload,
    actorId: string,
  ): Promise<TemplateSummary> {
    const template = await this.templates.create({
      organizationId,
      name: input.name,
      subject: input.subject,
      body: input.body,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'template.create',
      entityType: 'Template',
      entityId: template.id,
      metadata: { name: template.name },
    });

    return this.toSummary(template);
  }

  async update(
    organizationId: string,
    templateId: string,
    input: UpdateTemplatePayload,
    actorId: string,
  ): Promise<TemplateSummary> {
    const existing = await this.getOwnedTemplate(organizationId, templateId);

    // Never spread `undefined` fields into the repository call: an
    // explicit `{ subject: undefined }` would overwrite the existing value
    // in the in-memory adapter's `{ ...existing, ...input }` merge.
    const patch: UpdateTemplatePayload = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.subject !== undefined) patch.subject = input.subject;
    if (input.body !== undefined) patch.body = input.body;

    const updated = await this.templates.update(existing.id, patch);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'template.update',
      entityType: 'Template',
      entityId: templateId,
    });

    return this.toSummary(updated);
  }

  /** Copies subject/body/status ACTIVE under a new id — never mutates the source. */
  async duplicate(
    organizationId: string,
    templateId: string,
    actorId: string,
  ): Promise<TemplateSummary> {
    const existing = await this.getOwnedTemplate(organizationId, templateId);

    const duplicate = await this.templates.create({
      organizationId,
      name: `${existing.name} (copia)`,
      subject: existing.subject,
      body: existing.body,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'template.duplicate',
      entityType: 'Template',
      entityId: duplicate.id,
      metadata: { sourceTemplateId: existing.id },
    });

    return this.toSummary(duplicate);
  }

  async setStatus(
    organizationId: string,
    templateId: string,
    status: TemplateStatus,
    actorId: string,
  ): Promise<TemplateSummary> {
    const existing = await this.getOwnedTemplate(organizationId, templateId);
    const updated = await this.templates.update(existing.id, { status });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: status === 'ARCHIVED' ? 'template.archive' : 'template.restore',
      entityType: 'Template',
      entityId: templateId,
    });

    return this.toSummary(updated);
  }

  async softDelete(organizationId: string, templateId: string, actorId: string): Promise<void> {
    const existing = await this.getOwnedTemplate(organizationId, templateId);
    await this.templates.softDelete(existing.id);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'template.delete',
      entityType: 'Template',
      entityId: templateId,
    });
  }

  /** Same 404-not-403 rule as UsersService — see its comment for why. */
  private async getOwnedTemplate(organizationId: string, templateId: string): Promise<Template> {
    const template = await this.templates.findById(templateId);
    if (!template || template.organizationId !== organizationId) {
      throw new NotFoundException('Template not found.');
    }
    return template;
  }

  private toSummary(template: Template): TemplateSummary {
    const subjectVariables = validateTemplateVariables(template.subject).variables;
    const bodyVariables = validateTemplateVariables(template.body).variables;
    const variables = [...new Set([...subjectVariables, ...bodyVariables])];

    return {
      id: template.id,
      organizationId: template.organizationId,
      name: template.name,
      subject: template.subject,
      body: template.body,
      status: template.status,
      variables,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}
