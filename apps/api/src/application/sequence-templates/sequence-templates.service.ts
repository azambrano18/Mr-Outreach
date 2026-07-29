import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { validateTemplateVariables } from '@outreach/validation';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { SequenceTemplate } from '../../domain/sequence-template/sequence-template.entity';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SequenceTemplateStep, SequenceTemplateStepDelayUnit } from '../../domain/sequence-template/sequence-template-step.entity';
import { SequenceTemplateStepRepository } from '../../domain/sequence-template/sequence-template-step.repository';
import { SequenceTemplateVersion } from '../../domain/sequence-template/sequence-template-version.entity';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import {
  AUDIT_LOG_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  SEQUENCE_TEMPLATE_REPOSITORY,
  SEQUENCE_TEMPLATE_STEP_REPOSITORY,
  SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { htmlToPlainText } from '../../infrastructure/security/html-to-plain-text';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { SignaturesService } from '../signatures/signatures.service';
import { ExecutiveMailboxEligibilityService } from './executive-mailbox-eligibility.service';
import {
  SequenceTemplateDetail,
  SequenceTemplateStepSummary,
  SequenceTemplateSummary,
  SequenceTemplateVersionSummary,
} from './sequence-templates.types';

const DELAY_UNIT_LABELS: Record<SequenceTemplateStepDelayUnit, string> = {
  MINUTES: 'minutos',
  HOURS: 'horas',
  CALENDAR_DAYS: 'días calendario',
  BUSINESS_DAYS: 'días hábiles',
};

const ENVIO_LABEL: Record<1 | 2 | 3, string> = { 1: 'Envío 1', 2: 'Envío 2', 3: 'Envío 3' };

/** §13 — a Gestión only counts as "active" against this template once the server has actually accepted/started it; DRAFT/READY Gestiones aren't running anything the update could affect. */
const ACTIVE_EXECUTION_STATUSES = ['ACCEPTED', 'RUNNING'] as const;
/** §10 — broader than the update-impact set above: a Gestión already submitted to the server (even mid-submission) blocks deleting its Plantilla, since the server may still be about to act on it. */
const ACTIVE_EXECUTION_STATUSES_FOR_DELETE = ['SUBMITTING', 'SUBMISSION_UNKNOWN', 'ACCEPTED', 'RUNNING'] as const;

export interface TemplateUpdateImpact {
  currentVersion: number | null;
  activeExecutionsCount: number;
}

export interface TemplateDeletability {
  canDelete: boolean;
  activeExecutionsCount: number;
}

/** §1-3 — the only allowed weekdays, everywhere: not user-configurable, never Saturday/Sunday. */
export const FIXED_WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;
/** §3 — Envíos 2/3's fixed window. Envío 1's window is dynamic (see §2) — its sendWindowStart column is an unused sentinel. */
const FIXED_WINDOW_START = '08:00';
const FIXED_WINDOW_END = '19:00';

export interface CreateSequenceTemplateInput {
  mailboxId: string;
  name: string;
  description?: string | null;
}

/** §1/§5 (Fase 1.7) — `name` is now user-editable (see validateTemplateName); subject stays shared across the 3 envíos. Header is per-envío again (see UpdateSequenceTemplateStepInput). */
export interface UpdateSequenceTemplateInput {
  name?: string;
  description?: string | null;
  subjectTemplate?: string;
}

/**
 * §1-4 — no `enabled`, `allowedWeekdays`, `sendWindowStart`/`sendWindowEnd`,
 * `delayReference` or `delayUnit` (Fase 1.7 — always BUSINESS_DAYS, never
 * accepted from a caller; see SequenceTemplatesService.updateStep): the
 * schedule is fixed and non-configurable (Mon-Fri; Envío 1 runs from the
 * Gestión's effective start until 19:00; Envíos 2/3 run 08:00-19:00).
 * `headerText` is the individual, optional, plain-text header for this one
 * envío (§4, revised back from the shared version).
 */
export interface UpdateSequenceTemplateStepInput {
  headerText?: string | null;
  bodyHtml?: string;
  plainTextBody?: string;
  delayValue?: number;
}

/** §2 (Fase 1.7) — Envíos 2/3's only valid business-day range. */
const MIN_DELAY_BUSINESS_DAYS = 1;
const MAX_DELAY_BUSINESS_DAYS = 20;
/** §1 (Fase 1.7) — Plantilla name length bounds. */
const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 120;
/** §1 — rejects a name that is only a version number/word, with or without surrounding whitespace (e.g. "3", "Versión 3", "v3"). */
const VERSION_ONLY_NAME_PATTERN = /^(v(ersi[oó]n)?\.?\s*)?\d+$/i;

export interface TemplatePublishValidation {
  valid: boolean;
  errors: string[];
}

function maskToken(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  // The ciphertext itself never leaves this service — this is a display-only
  // fingerprint derived from it, not the encrypted value nor the plaintext.
  return `tpt_****${ciphertext.slice(-6)}`;
}

/** §2/§3 — exact required copy, not a generic sentence builder: each envío's rule is fixed and worded differently. */
function describeSchedule(step: Pick<SequenceTemplateStep, 'stepNumber' | 'delayValue' | 'delayUnit'>): string {
  if (step.stepNumber === 1) {
    return 'El Envío 1 comenzará al iniciar la Gestión y podrá ejecutarse hasta las 19:00, de lunes a viernes.';
  }
  const previous = step.stepNumber === 2 ? 'Envío 1' : 'Envío 2';
  const amount = `${step.delayValue} ${DELAY_UNIT_LABELS[step.delayUnit]}`;
  return `Se enviará ${amount} después del ${previous}, de lunes a viernes entre las 08:00 y las 19:00.`;
}

@Injectable()
export class SequenceTemplatesService {
  constructor(
    @Inject(SEQUENCE_TEMPLATE_REPOSITORY) private readonly templates: SequenceTemplateRepository,
    @Inject(SEQUENCE_TEMPLATE_STEP_REPOSITORY) private readonly steps: SequenceTemplateStepRepository,
    @Inject(SEQUENCE_TEMPLATE_VERSION_REPOSITORY) private readonly versions: SequenceTemplateVersionRepository,
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    private readonly eligibility: ExecutiveMailboxEligibilityService,
    private readonly mailboxesService: MailboxesService,
    private readonly signatures: SignaturesService,
    private readonly sanitizer: HtmlSanitizerService,
  ) {}

  async create(organizationId: string, ownerUserId: string, input: CreateSequenceTemplateInput): Promise<SequenceTemplateDetail> {
    const mailbox = await this.eligibility.requireEligible(organizationId, ownerUserId, input.mailboxId);
    const name = await this.validateTemplateName(organizationId, ownerUserId, mailbox.id, input.name);

    const template = await this.templates.create({
      organizationId,
      ownerUserId,
      mailboxId: mailbox.id,
      name,
      description: input.description ?? null,
      timezone: 'America/Santiago',
    });

    for (const stepNumber of [1, 2, 3] as const) {
      await this.steps.create({
        organizationId,
        templateId: template.id,
        stepNumber,
        name: ENVIO_LABEL[stepNumber],
      });
    }

    await this.audit.record({
      organizationId,
      actorId: ownerUserId,
      action: 'sequence_template.create',
      entityType: 'SequenceTemplate',
      entityId: template.id,
      metadata: { mailboxId: mailbox.id, name },
    });

    return this.getDetail(organizationId, ownerUserId, template.id);
  }

  /**
   * §1 (Fase 1.7) — required, trimmed, length-bounded, never just a version
   * number/word. Uniqueness is scoped to (mailbox, owner): the same
   * executive can't have two Plantillas with the same name on the same
   * cuenta, but the same name is free to reuse on a different cuenta, and
   * never collides with a template's own current name when just re-saving
   * (`excludeTemplateId`).
   */
  private async validateTemplateName(
    organizationId: string,
    ownerUserId: string,
    mailboxId: string,
    rawName: string,
    excludeTemplateId?: string,
  ): Promise<string> {
    const name = rawName.trim();
    if (VERSION_ONLY_NAME_PATTERN.test(name)) {
      throw new BadRequestException('El nombre no puede ser solamente un número de versión.');
    }
    if (name.length < MIN_NAME_LENGTH) {
      throw new BadRequestException(`El nombre debe tener al menos ${MIN_NAME_LENGTH} caracteres.`);
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new BadRequestException(`El nombre no puede superar los ${MAX_NAME_LENGTH} caracteres.`);
    }
    const siblings = await this.templates.findByMailbox(organizationId, mailboxId);
    const collides = siblings.some(
      (t) => t.id !== excludeTemplateId && t.ownerUserId === ownerUserId && t.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (collides) {
      throw new ConflictException('Ya tienes una plantilla con ese nombre en esta cuenta.');
    }
    return name;
  }

  async listOwn(organizationId: string, ownerUserId: string): Promise<SequenceTemplateSummary[]> {
    const templates = await this.templates.findByOwner(organizationId, ownerUserId);
    return Promise.all(templates.map((template) => this.toSummary(template)));
  }

  async getDetail(organizationId: string, ownerUserId: string, id: string): Promise<SequenceTemplateDetail> {
    const template = await this.requireOwned(organizationId, ownerUserId, id);
    const summary = await this.toSummary(template);
    const stepRows = await this.steps.findByTemplate(id);
    const versionRows = await this.versions.findByTemplate(id);

    const stepSummaries = stepRows.map((step) => this.toStepSummary(step));
    // §6 — variable detection/validation stays fully in effect; only the
    // standalone "Variables utilizadas" UI block was removed (frontend-only).
    const variablesUsed = [
      ...new Set([
        ...validateTemplateVariables(template.subjectTemplate).variables,
        ...stepSummaries.flatMap((step) => [
          ...validateTemplateVariables(step.headerText ?? '').variables,
          ...validateTemplateVariables(step.bodyHtml).variables,
        ]),
      ]),
    ];

    const signatureHtml = await this.getSignatureHtmlForMailbox(organizationId, template.mailboxId);

    return {
      ...summary,
      steps: stepSummaries,
      variablesUsed,
      versions: versionRows.map((v) => this.toVersionSummary(v)),
      signatureHtml,
    };
  }

  async update(organizationId: string, ownerUserId: string, id: string, input: UpdateSequenceTemplateInput): Promise<SequenceTemplateDetail> {
    const template = await this.requireOwned(organizationId, ownerUserId, id);
    if (template.status === 'ARCHIVED') {
      throw new ConflictException('Esta plantilla está archivada.');
    }

    if (input.subjectTemplate !== undefined) {
      const result = validateTemplateVariables(input.subjectTemplate);
      if (!result.valid) {
        throw new BadRequestException(`Variable inválida en el asunto: ${result.errors.join(', ')}`);
      }
    }

    const name =
      input.name !== undefined
        ? await this.validateTemplateName(organizationId, ownerUserId, template.mailboxId, input.name, id)
        : undefined;

    await this.templates.update(id, {
      name,
      description: input.description,
      subjectTemplate: input.subjectTemplate,
      currentDraftVersion: template.currentDraftVersion + 1,
    });
    await this.audit.record({
      organizationId,
      actorId: ownerUserId,
      action: 'sequence_template.update',
      entityType: 'SequenceTemplate',
      entityId: id,
      metadata: {},
    });
    return this.getDetail(organizationId, ownerUserId, id);
  }

  async updateStep(
    organizationId: string,
    ownerUserId: string,
    templateId: string,
    stepNumber: 1 | 2 | 3,
    input: UpdateSequenceTemplateStepInput,
  ): Promise<SequenceTemplateDetail> {
    const template = await this.requireOwned(organizationId, ownerUserId, templateId);
    if (template.status === 'ARCHIVED') {
      throw new ConflictException('Esta plantilla está archivada.');
    }
    const stepRows = await this.steps.findByTemplate(templateId);
    const step = stepRows.find((s) => s.stepNumber === stepNumber);
    if (!step) throw new NotFoundException('Envío no encontrado.');

    if (stepNumber !== 1 && input.delayValue !== undefined) {
      if (!Number.isInteger(input.delayValue)) {
        throw new BadRequestException('Los días hábiles deben ser un número entero.');
      }
      if (input.delayValue < MIN_DELAY_BUSINESS_DAYS || input.delayValue > MAX_DELAY_BUSINESS_DAYS) {
        throw new BadRequestException(
          `Los días hábiles deben estar entre ${MIN_DELAY_BUSINESS_DAYS} y ${MAX_DELAY_BUSINESS_DAYS}.`,
        );
      }
    }

    const bodyHtml = input.bodyHtml !== undefined ? this.sanitizer.sanitize(input.bodyHtml) : undefined;
    const bodyText = input.plainTextBody?.trim() || (bodyHtml !== undefined ? htmlToPlainText(bodyHtml) : undefined);
    const headerText = input.headerText !== undefined ? input.headerText?.trim() || null : undefined;

    for (const text of [bodyHtml, headerText ?? undefined].filter((t): t is string => Boolean(t))) {
      const result = validateTemplateVariables(text);
      if (!result.valid) {
        throw new BadRequestException(`Variable inválida en ${ENVIO_LABEL[stepNumber]}: ${result.errors.join(', ')}`);
      }
    }

    await this.steps.update(step.id, {
      headerText,
      bodyHtml,
      bodyText,
      delayValue: stepNumber === 1 ? undefined : input.delayValue,
      // §2 (Fase 1.7) — always re-asserted, regardless of what a caller could send: the wait unit is never anything but business days.
      delayUnit: stepNumber === 1 ? undefined : 'BUSINESS_DAYS',
      // §1-3 — always re-asserted, regardless of what a caller sends: fixed schedule, never user-controlled.
      allowedWeekdays: [...FIXED_WEEKDAYS],
      sendWindowStart: stepNumber === 1 ? '00:00' : FIXED_WINDOW_START,
      sendWindowEnd: FIXED_WINDOW_END,
    });

    await this.templates.update(templateId, { currentDraftVersion: template.currentDraftVersion + 1 });

    await this.audit.record({
      organizationId,
      actorId: ownerUserId,
      action: 'sequence_template.update',
      entityType: 'SequenceTemplate',
      entityId: templateId,
      metadata: { stepNumber },
    });

    return this.getDetail(organizationId, ownerUserId, templateId);
  }

  /**
   * §9 — the single source of truth both the "Publicar plantilla" preflight
   * endpoint and PublishSequenceTemplateUseCase itself call, so the rules
   * can never drift between "what the confirm modal allowed" and "what the
   * publish call actually enforces". Never throws for a content problem —
   * those accumulate into `errors`; only a missing/foreign template still
   * throws NotFoundException (there's nothing sensible to validate against).
   */
  async validateForPublish(organizationId: string, ownerUserId: string, id: string): Promise<TemplatePublishValidation> {
    const template = await this.requireOwned(organizationId, ownerUserId, id);
    const errors: string[] = [];

    try {
      await this.eligibility.requireEligible(organizationId, ownerUserId, template.mailboxId);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'La cuenta de correo no está disponible para publicar.');
    }

    if (!template.subjectTemplate.trim()) {
      errors.push('El asunto es obligatorio.');
    } else if (!validateTemplateVariables(template.subjectTemplate).valid) {
      errors.push(`Variable inválida en el asunto: ${validateTemplateVariables(template.subjectTemplate).errors.join(', ')}`);
    }

    const stepRows = await this.steps.findByTemplate(id);
    if (stepRows.length !== 3) {
      errors.push('La plantilla debe tener exactamente 3 envíos configurados.');
    }
    for (const step of stepRows.sort((a, b) => a.stepNumber - b.stepNumber)) {
      const label = ENVIO_LABEL[step.stepNumber];
      if (!step.bodyHtml.trim()) {
        errors.push(`${label}: el cuerpo del correo es obligatorio.`);
      } else {
        const result = validateTemplateVariables(step.bodyHtml);
        if (!result.valid) errors.push(`${label}: variable inválida (${result.errors.join(', ')}).`);
      }
      if (step.headerText && !validateTemplateVariables(step.headerText).valid) {
        errors.push(`${label}: variable inválida en el header (${validateTemplateVariables(step.headerText).errors.join(', ')}).`);
      }
      if (step.stepNumber !== 1 && step.delayValue < 0) {
        errors.push(`${label}: el tiempo de espera no puede ser negativo.`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** §14 — Mr Outreach's own local estimate for the "Confirmar actualización de plantilla" modal, computed before ever contacting the motor; the authoritative affected/unchanged job counts only exist once the motor itself responds (see UpdateSequenceTemplateUseCase). */
  async getUpdateImpact(organizationId: string, ownerUserId: string, id: string): Promise<TemplateUpdateImpact> {
    const template = await this.requireOwned(organizationId, ownerUserId, id);
    const latest = await this.versions.findLatestByTemplate(id);
    const executions = await this.executions.findByExecutive(organizationId, ownerUserId);
    const activeExecutionsCount = executions.filter(
      (e) => e.templateId === template.id && (ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(e.status),
    ).length;
    return { currentVersion: latest?.versionNumber ?? null, activeExecutionsCount };
  }

  async archive(organizationId: string, ownerUserId: string, id: string): Promise<void> {
    const template = await this.requireOwned(organizationId, ownerUserId, id);
    if (template.status === 'ARCHIVED') {
      throw new ConflictException('Esta plantilla ya está archivada.');
    }
    await this.templates.update(id, { status: 'ARCHIVED', archivedAt: new Date() });
    await this.audit.record({
      organizationId,
      actorId: ownerUserId,
      action: 'sequence_template.archive',
      entityType: 'SequenceTemplate',
      entityId: id,
      metadata: {},
    });
  }

  /** §11 — reopens an archived template as an editable draft again; must be published anew (new version, new token) to become usable. */
  async reopenArchived(organizationId: string, ownerUserId: string, id: string): Promise<SequenceTemplateDetail> {
    const template = await this.requireOwned(organizationId, ownerUserId, id);
    if (template.status !== 'ARCHIVED') {
      throw new ConflictException('Solo una plantilla archivada puede reabrirse como borrador.');
    }
    await this.templates.update(id, { status: 'DRAFT', archivedAt: null });
    await this.audit.record({
      organizationId,
      actorId: ownerUserId,
      action: 'sequence_template.archived_edit_started',
      entityType: 'SequenceTemplate',
      entityId: id,
      metadata: { mailboxId: template.mailboxId },
    });
    return this.getDetail(organizationId, ownerUserId, id);
  }

  /** §10 — counts Gestiones the server may still be acting on for this template, across every executive (a Plantilla can only ever belong to one owner, but this stays defensive). */
  private async countActiveExecutionsForDelete(organizationId: string, templateId: string): Promise<number> {
    const executions = await this.executions.findAllByOrganization(organizationId);
    return executions.filter(
      (e) => e.templateId === templateId && (ACTIVE_EXECUTION_STATUSES_FOR_DELETE as readonly string[]).includes(e.status),
    ).length;
  }

  /** §10 — preflight for the "Eliminar" button/confirmation on a PUBLISHED Plantilla. */
  async canDeleteTemplate(organizationId: string, ownerUserId: string, id: string): Promise<TemplateDeletability> {
    const template = await this.requireOwned(organizationId, ownerUserId, id);
    const activeExecutionsCount = await this.countActiveExecutionsForDelete(organizationId, template.id);
    return { canDelete: activeExecutionsCount === 0, activeExecutionsCount };
  }

  /**
   * §8-10 — the single "Eliminar" entry point; behavior depends on the
   * Plantilla's current status:
   *  - DRAFT / PUBLISH_FAILED (never successfully published): hard delete —
   *    nothing references it yet, so the row and its envíos are removed
   *    outright, no server command involved.
   *  - ARCHIVED: logical delete (`deletedAt`) — historical versions,
   *    Gestiones and audit entries keep working; it only disappears from
   *    listings going forward.
   *  - PUBLISHED: allowed only when zero Gestiones are still active against
   *    it (§10); then retired the same way an archived one is (status
   *    flips to ARCHIVED + `deletedAt`, in one step) so it also leaves the
   *    "Publicadas" tab and every selector immediately.
   *  - PUBLISHING: never — an in-flight publish must resolve first.
   */
  async deleteTemplate(organizationId: string, ownerUserId: string, id: string): Promise<void> {
    const template = await this.requireOwned(organizationId, ownerUserId, id);

    if (template.status === 'DRAFT' || template.status === 'PUBLISH_FAILED') {
      await this.steps.deleteByTemplate(id);
      await this.templates.delete(id);
      await this.audit.record({
        organizationId,
        actorId: ownerUserId,
        action: 'sequence_template.draft_deleted',
        entityType: 'SequenceTemplate',
        entityId: id,
        metadata: { mailboxId: template.mailboxId },
      });
      return;
    }

    if (template.status === 'ARCHIVED') {
      await this.templates.update(id, { deletedAt: new Date() });
      await this.audit.record({
        organizationId,
        actorId: ownerUserId,
        action: 'sequence_template.archived_deleted',
        entityType: 'SequenceTemplate',
        entityId: id,
        metadata: { mailboxId: template.mailboxId },
      });
      return;
    }

    if (template.status === 'PUBLISHED') {
      const activeExecutionsCount = await this.countActiveExecutionsForDelete(organizationId, id);
      if (activeExecutionsCount > 0) {
        throw new ConflictException('Esta plantilla no puede eliminarse porque está siendo utilizada por una o más Gestiones activas.');
      }
      await this.templates.update(id, { status: 'ARCHIVED', archivedAt: template.archivedAt ?? new Date(), deletedAt: new Date() });
      await this.audit.record({
        organizationId,
        actorId: ownerUserId,
        action: 'sequence_template.published_deleted',
        entityType: 'SequenceTemplate',
        entityId: id,
        metadata: { mailboxId: template.mailboxId },
      });
      return;
    }

    throw new ConflictException('Esta plantilla no puede eliminarse mientras se está publicando.');
  }

  async requireOwned(organizationId: string, ownerUserId: string, id: string): Promise<SequenceTemplate> {
    const template = await this.templates.findById(id);
    if (!template || template.organizationId !== organizationId || template.ownerUserId !== ownerUserId) {
      throw new NotFoundException('Plantilla no encontrada.');
    }
    return template;
  }

  async getStepsForPublish(templateId: string): Promise<SequenceTemplateStep[]> {
    return this.steps.findByTemplate(templateId);
  }

  async getSignatureHtmlForMailbox(organizationId: string, mailboxId: string): Promise<string> {
    const signature = await this.signatures.getByMailbox(organizationId, mailboxId).catch(() => null);
    return signature?.activeVersion?.htmlContent ?? '';
  }

  private toStepSummary(step: SequenceTemplateStep): SequenceTemplateStepSummary {
    return {
      id: step.id,
      stepNumber: step.stepNumber,
      headerText: step.headerText,
      bodyHtml: step.bodyHtml,
      bodyText: step.bodyText,
      delayValue: step.delayValue,
      delayUnit: step.delayUnit,
      delayReference: step.delayReference,
      allowedWeekdays: step.allowedWeekdays,
      sendWindowStart: step.sendWindowStart,
      sendWindowEnd: step.sendWindowEnd,
      scheduleDescription: describeSchedule(step),
    };
  }

  private toVersionSummary(version: SequenceTemplateVersion): SequenceTemplateVersionSummary {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      templateTokenMasked: maskToken(version.templateTokenCiphertext),
      serverTemplateId: version.serverTemplateId,
      acceptedAt: version.acceptedAt ? version.acceptedAt.toISOString() : null,
      lastError: version.lastError,
      createdAt: version.createdAt.toISOString(),
      previousVersionNumber: version.previousVersionNumber,
      effectiveScope: version.effectiveScope,
      affectedExecutions: version.affectedExecutions,
      affectedPendingJobs: version.affectedPendingJobs,
      unchangedSentJobs: version.unchangedSentJobs,
      processingJobsNotChanged: version.processingJobsNotChanged,
      appliedAt: version.appliedAt ? version.appliedAt.toISOString() : null,
    };
  }

  private async toSummary(template: SequenceTemplate): Promise<SequenceTemplateSummary> {
    const mailbox = await this.mailboxesService.getById(template.organizationId, template.mailboxId).catch(() => null);
    const latest = await this.versions.findLatestByTemplate(template.id);
    const activeExecutionsCount =
      template.status === 'PUBLISHED' ? await this.countActiveExecutionsForDelete(template.organizationId, template.id) : 0;
    return {
      id: template.id,
      organizationId: template.organizationId,
      ownerUserId: template.ownerUserId,
      mailboxId: template.mailboxId,
      mailboxEmail: mailbox?.email ?? '',
      clientName: mailbox?.clientName ?? null,
      domainName: mailbox?.domainName ?? null,
      name: template.name,
      description: template.description,
      subjectTemplate: template.subjectTemplate,
      status: template.status,
      currentDraftVersion: template.currentDraftVersion,
      timezone: template.timezone,
      latestPublishedVersion: latest ? this.toVersionSummary(latest) : null,
      activeExecutionsCount,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
      archivedAt: template.archivedAt ? template.archivedAt.toISOString() : null,
    };
  }
}
