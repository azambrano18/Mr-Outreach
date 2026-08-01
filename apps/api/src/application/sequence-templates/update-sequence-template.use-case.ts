import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateTemplateVariables } from '@outreach/validation';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import {
  SEQUENCE_TEMPLATE_MOTOR_PORT,
  SequenceTemplateMotorPort,
} from '../../domain/sequence-template-motor/sequence-template-motor-port';
import { AUDIT_LOG_REPOSITORY, SEQUENCE_TEMPLATE_REPOSITORY, SEQUENCE_TEMPLATE_VERSION_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ExecutiveMailboxEligibilityService } from './executive-mailbox-eligibility.service';
import { SequenceTemplatesService } from './sequence-templates.service';
import { SequenceTemplateVersionSummary } from './sequence-templates.types';

const BLOCKED_STATUSES = ['PUBLISHING'] as const;

export interface UpdateSequenceTemplateInput {
  organizationId: string;
  templateId: string;
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface UpdateSequenceTemplateResultSummary {
  templateId: string;
  version: SequenceTemplateVersionSummary;
}

/**
 * §12-17 — the ONLY way to change content on an already-PUBLISHED template.
 * Unlike PublishSequenceTemplateUseCase (which transitions the template's
 * own status DRAFT→PUBLISHED/PUBLISH_FAILED), this use case never touches
 * `template.status` on failure — the previously-accepted version stays the
 * active one no matter what happens here, and the template is only ever
 * left at PUBLISHED (briefly PUBLISHING while the motor call is in flight,
 * as a concurrency guard). The new version always carries
 * `previousVersionNumber` so history reads as an explicit chain.
 *
 * Consolidación contractual — this calls the exact same
 * `motor.publishTemplate` a first publish uses (never a separate
 * "update-in-place" command), passing `previousServerTemplateId` purely for
 * Railway's own audit trail. The result is always a brand-new, independent
 * `serverTemplateId`; nothing here ever asks the motor to modify jobs
 * belonging to the previous version, and no active Gestión is ever
 * referenced or touched. The base version to publish from is resolved via
 * `findLatestAcceptedByTemplate` (never `findLatestByTemplate`), so a prior
 * FAILED publish attempt can never block creating another corrected
 * version — §5's mandatory case (v1 ACCEPTED, v2 FAILED → v3 still
 * publishable from v1).
 */
@Injectable()
export class UpdateSequenceTemplateUseCase {
  constructor(
    @Inject(SEQUENCE_TEMPLATE_REPOSITORY) private readonly templates: SequenceTemplateRepository,
    @Inject(SEQUENCE_TEMPLATE_VERSION_REPOSITORY) private readonly versions: SequenceTemplateVersionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(SEQUENCE_TEMPLATE_MOTOR_PORT) private readonly motor: SequenceTemplateMotorPort,
    private readonly templatesService: SequenceTemplatesService,
    private readonly eligibility: ExecutiveMailboxEligibilityService,
    private readonly secrets: SecretEncryptionService,
  ) {}

  async execute(input: UpdateSequenceTemplateInput): Promise<UpdateSequenceTemplateResultSummary> {
    const template = await this.templatesService.requireOwned(input.organizationId, input.actorId, input.templateId);
    if (template.status !== 'PUBLISHED') {
      throw new ConflictException('Solo una plantilla publicada puede actualizarse mediante este flujo.');
    }

    const currentVersion = await this.versions.findLatestAcceptedByTemplate(template.id);
    if (!currentVersion || currentVersion.status !== 'ACCEPTED' || !currentVersion.serverTemplateId) {
      throw new ConflictException('Esta plantilla no tiene una versión publicada aceptada por el servidor.');
    }

    const validation = await this.templatesService.validateForPublish(input.organizationId, input.actorId, input.templateId);
    if (!validation.valid) {
      throw new BadRequestException(validation.errors.join(' '));
    }

    const claimed = await this.templates.conditionalUpdateStatus(template.id, [...BLOCKED_STATUSES], 'PUBLISHING');
    if (claimed === 0) {
      throw new ConflictException('Ya hay una publicación en curso para esta plantilla.');
    }

    try {
      const mailbox = await this.eligibility.requireEligible(input.organizationId, input.actorId, template.mailboxId);

      const stepRows = (await this.templatesService.getStepsForPublish(template.id)).sort((a, b) => a.stepNumber - b.stepNumber);
      // Fase 2 (R2) — the mailbox's current live signature; a new version can
      // carry a different signature than the one it's replacing (§12) since
      // the account's signature may have changed since the last publish.
      const signatureHtml = await this.templatesService.getSignatureHtmlForMailbox(input.organizationId, template.mailboxId);

      const variableKeys = [
        ...new Set([
          ...validateTemplateVariables(template.subjectTemplate).variables,
          ...stepRows.flatMap((step) => [
            ...validateTemplateVariables(step.headerText ?? '').variables,
            ...validateTemplateVariables(step.bodyHtml).variables,
          ]),
        ]),
      ];
      const standardKeys = new Set(['email', 'contact_name', 'company_name']);
      const variables = variableKeys.map((key) => ({ key, required: !standardKeys.has(key) }));

      const commandId = randomUUID();
      const correlationId = input.correlationId ?? randomUUID();

      await this.audit.record({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: 'sequence_template.update_requested',
        entityType: 'SequenceTemplate',
        entityId: template.id,
        metadata: { commandId, correlationId, currentVersion: currentVersion.versionNumber },
      });

      const newVersion = await this.versions.create({
        templateId: template.id,
        name: template.name,
        mailboxId: template.mailboxId,
        timezone: template.timezone,
        subjectTemplate: template.subjectTemplate,
        signatureHtml,
        variables,
        steps: stepRows.map((step) => ({
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
        })),
        lastPublishCommandId: commandId,
        createdBy: input.actorId,
        previousVersionNumber: currentVersion.versionNumber,
      });

      await this.audit.record({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: 'sequence_template.update_draft_created',
        entityType: 'SequenceTemplate',
        entityId: template.id,
        metadata: { templateVersionId: newVersion.id, previousVersion: currentVersion.versionNumber, newVersion: newVersion.versionNumber },
      });

      const result = await this.motor.publishTemplate({
        idempotencyKey: input.idempotencyKey,
        correlationId,
        organizationId: input.organizationId,
        executiveUserId: input.actorId,
        localTemplateId: template.id,
        // §7 — the prior ACCEPTED version's own id; informational for Railway's audit trail only, never a request to modify it.
        previousServerTemplateId: currentVersion.serverTemplateId,
        serverMailboxId: mailbox.serverMailboxId ?? mailbox.id,
        mailboxEmail: mailbox.email,
        name: template.name,
        version: newVersion.versionNumber,
        timezone: template.timezone,
        subjectTemplate: template.subjectTemplate,
        signatureHtml,
        variables,
        steps: stepRows.map((step) => ({
          stepNumber: step.stepNumber,
          headerText: step.headerText,
          bodyHtml: step.bodyHtml,
          bodyText: step.bodyText,
          schedule: {
            delayValue: step.delayValue,
            delayUnit: step.delayUnit,
            delayReference: step.delayReference,
            allowedWeekdays: step.allowedWeekdays,
            sendWindowStart: step.sendWindowStart,
            sendWindowEnd: step.sendWindowEnd,
          },
        })),
      });

      const updatedVersion = await this.versions.update(newVersion.id, {
        status: result.accepted ? 'ACCEPTED' : 'FAILED',
        serverTemplateId: result.serverTemplateId,
        templateTokenCiphertext: result.templateToken ? this.secrets.encrypt(result.templateToken) : null,
        acceptedAt: result.acceptedAt,
        lastError: result.rejectionReason,
      });

      // §13/§17 — the template's own status always returns to PUBLISHED: on
      // success the NEW version is now the active one; on failure the
      // PREVIOUS version stays active. Never PUBLISH_FAILED here — that
      // status means "never successfully published at all", which isn't
      // true for a template that already has an ACCEPTED prior version.
      await this.templates.update(template.id, { status: 'PUBLISHED' });

      await this.audit.record({
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: result.accepted ? 'sequence_template.update_applied' : 'sequence_template.update_failed',
        entityType: 'SequenceTemplate',
        entityId: template.id,
        metadata: {
          templateVersionId: newVersion.id,
          previousVersion: currentVersion.versionNumber,
          newVersion: newVersion.versionNumber,
          previousServerTemplateId: currentVersion.serverTemplateId,
          serverTemplateId: result.serverTemplateId,
          correlationId,
          error: result.rejectionReason,
        },
      });

      return {
        templateId: template.id,
        version: {
          id: updatedVersion.id,
          versionNumber: updatedVersion.versionNumber,
          status: updatedVersion.status,
          templateTokenMasked: updatedVersion.templateTokenCiphertext
            ? `tpt_****${updatedVersion.templateTokenCiphertext.slice(-6)}`
            : null,
          serverTemplateId: updatedVersion.serverTemplateId,
          acceptedAt: updatedVersion.acceptedAt ? updatedVersion.acceptedAt.toISOString() : null,
          lastError: updatedVersion.lastError,
          createdAt: updatedVersion.createdAt.toISOString(),
          previousVersionNumber: updatedVersion.previousVersionNumber,
        },
      };
    } catch (error) {
      // Fail-closed: whatever went wrong, the template must never be left
      // stuck in PUBLISHING — and it must never become PUBLISH_FAILED here,
      // since the previous version is still perfectly valid and active.
      await this.templates.update(template.id, { status: 'PUBLISHED' }).catch(() => undefined);
      await this.audit
        .record({
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: 'sequence_template.update_failed',
          entityType: 'SequenceTemplate',
          entityId: template.id,
          // Sanitized: only the error's own message, never a stack trace or request/response body.
          metadata: { error: error instanceof Error ? error.message : 'Error desconocido al actualizar la plantilla.' },
        })
        .catch(() => undefined);
      throw error;
    }
  }
}
