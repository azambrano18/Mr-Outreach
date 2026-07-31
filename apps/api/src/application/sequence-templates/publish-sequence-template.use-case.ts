import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateTemplateVariables } from '@outreach/validation';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { TransactionManager } from '../../domain/persistence/transaction';
import { SequenceTemplateStatus } from '../../domain/sequence-template/sequence-template.entity';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import {
  SEQUENCE_TEMPLATE_MOTOR_PORT,
  SequenceTemplateMotorPort,
} from '../../domain/sequence-template-motor/sequence-template-motor-port';
import {
  AUDIT_LOG_REPOSITORY,
  INTEGRATION_COMMAND_REPOSITORY,
  SEQUENCE_TEMPLATE_REPOSITORY,
  SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { buildIdempotencyStorageKey } from '../idempotency/idempotent-operation.service';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { ExecutiveMailboxEligibilityService } from './executive-mailbox-eligibility.service';
import { SequenceTemplatesService } from './sequence-templates.service';
import { SequenceTemplateVersionSummary } from './sequence-templates.types';

const BLOCKED_STATUSES: SequenceTemplateStatus[] = ['PUBLISHING'];

export interface PublishSequenceTemplateInput {
  organizationId: string;
  templateId: string;
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface PublishSequenceTemplateResultSummary {
  templateId: string;
  status: SequenceTemplateStatus;
  version: SequenceTemplateVersionSummary;
}

/**
 * §5/§9-13 — publishing runs the same `validateForPublish` the confirm
 * modal's preflight endpoint uses (single source of truth, §9), then
 * snapshots the current mutable step content + the shared subject/header +
 * the mailbox's live signature into one new immutable
 * SequenceTemplateVersion, calls the motor once (idempotent by
 * `idempotencyKey`), and persists whatever it returns. The version's
 * content snapshot fields are never updated afterward — only status/
 * serverTemplateId/templateTokenCiphertext/acceptedAt/lastError transition
 * once, right after the motor call.
 */
@Injectable()
export class PublishSequenceTemplateUseCase {
  constructor(
    @Inject(SEQUENCE_TEMPLATE_REPOSITORY) private readonly templates: SequenceTemplateRepository,
    @Inject(SEQUENCE_TEMPLATE_VERSION_REPOSITORY) private readonly versions: SequenceTemplateVersionRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(SEQUENCE_TEMPLATE_MOTOR_PORT) private readonly motor: SequenceTemplateMotorPort,
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(INTEGRATION_COMMAND_REPOSITORY) private readonly commands: IntegrationCommandRepository,
    private readonly templatesService: SequenceTemplatesService,
    private readonly eligibility: ExecutiveMailboxEligibilityService,
    private readonly secrets: SecretEncryptionService,
  ) {}

  async execute(input: PublishSequenceTemplateInput): Promise<PublishSequenceTemplateResultSummary> {
    const template = await this.templatesService.requireOwned(input.organizationId, input.actorId, input.templateId);

    const validation = await this.templatesService.validateForPublish(input.organizationId, input.actorId, input.templateId);
    if (!validation.valid) {
      throw new BadRequestException(validation.errors.join(' '));
    }

    // Fase "Comandos y eventos del flujo activo" — a genuine, previously-
    // missing idempotency check: this use case's own `input.idempotencyKey`
    // was accepted but never verified before. A duplicate client retry with
    // the same key now replays the already-persisted outcome instead of
    // creating a second SequenceTemplateVersion and calling the motor again.
    const storageKey = buildIdempotencyStorageKey('sequence_template.publish', input.idempotencyKey);
    const existingCommand = await this.commands.findByIdempotencyKey(input.organizationId, storageKey);
    if (existingCommand && (existingCommand.status === 'COMPLETED' || existingCommand.status === 'FAILED')) {
      return existingCommand.resultSnapshot as unknown as PublishSequenceTemplateResultSummary;
    }

    // §3 — fail-closed re-check, even though validateForPublish above already checked it moments ago.
    const mailbox = await this.eligibility.requireEligible(input.organizationId, input.actorId, template.mailboxId);
    const stepRows = (await this.templatesService.getStepsForPublish(template.id)).sort((a, b) => a.stepNumber - b.stepNumber);
    // Fase Firma — the template's own signature draft, authored in its editor; never re-read from the mailbox at publish time anymore.
    const signatureHtml = template.signatureHtml;

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

    const commandId = existingCommand?.commandId ?? `cmd_${randomUUID()}`;
    const correlationId = input.correlationId ?? existingCommand?.correlationId ?? randomUUID();

    // ETAPA A — transacción local: reclama PUBLISHING, congela el snapshot
    // (SequenceTemplateVersion) y crea/localiza el IntegrationCommand
    // REQUESTED, todo o nada. El motor todavía no fue llamado.
    const { version, commandRowId } = await this.tx.run(async (ctx) => {
      const claimed = await this.templates.conditionalUpdateStatus(template.id, BLOCKED_STATUSES, 'PUBLISHING', ctx);
      if (claimed === 0) {
        throw new ConflictException('Ya hay una publicación en curso para esta plantilla.');
      }

      await this.audit.record(
        {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: 'sequence_template.publish_requested',
          entityType: 'SequenceTemplate',
          entityId: template.id,
          metadata: { commandId, correlationId },
        },
        ctx,
      );

      const version = await this.versions.create(
        {
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
        },
        ctx,
      );

      const commandRow = existingCommand
        ? existingCommand
        : await this.commands.create(
            {
              organizationId: input.organizationId,
              commandId,
              commandType: 'TEMPLATE_PUBLISH_REQUESTED',
              aggregateType: 'TEMPLATE',
              aggregateId: version.id,
              schemaVersion: '1.0',
              idempotencyKey: storageKey,
              correlationId,
              payload: { templateId: template.id, versionNumber: version.versionNumber },
              requestedBy: input.actorId,
            },
            ctx,
          );

      return { version, commandRowId: commandRow.id };
    });

    try {
      const result = await this.motor.publishTemplate({
        idempotencyKey: input.idempotencyKey,
        correlationId,
        organizationId: input.organizationId,
        executiveUserId: input.actorId,
        localTemplateId: template.id,
        // §7 — null on a template's first-ever publish; only a later "editar plantilla publicada" carries a real prior id.
        previousServerTemplateId: null,
        serverMailboxId: mailbox.serverMailboxId ?? mailbox.id,
        mailboxEmail: mailbox.email,
        name: template.name,
        version: version.versionNumber,
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

      const finalStatus: SequenceTemplateStatus = result.accepted ? 'PUBLISHED' : 'PUBLISH_FAILED';

      // ETAPA C — transacción de resultado: versión + plantilla +
      // IntegrationCommand + auditoría, todo o nada. El motor ya respondió.
      const summary = await this.tx.run(async (ctx) => {
        const updatedVersion = await this.versions.update(
          version.id,
          {
            status: result.status,
            serverTemplateId: result.serverTemplateId,
            templateTokenCiphertext: result.templateToken ? this.secrets.encrypt(result.templateToken) : null,
            acceptedAt: result.acceptedAt,
            lastError: result.rejectionReason,
          },
          ctx,
        );

        await this.templates.update(template.id, { status: finalStatus }, ctx);

        const summary: PublishSequenceTemplateResultSummary = {
          templateId: template.id,
          status: finalStatus,
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

        await this.commands.update(
          commandRowId,
          {
            status: result.accepted ? 'COMPLETED' : 'FAILED',
            completedAt: new Date(),
            lastError: result.rejectionReason,
            resultSnapshot: summary as unknown as Record<string, unknown>,
          },
          ctx,
        );

        await this.audit.record(
          {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: result.accepted ? 'sequence_template.published' : 'sequence_template.publish_failed',
            entityType: 'SequenceTemplate',
            entityId: template.id,
            metadata: {
              templateVersionId: version.id,
              serverTemplateId: result.serverTemplateId,
              correlationId,
              error: result.rejectionReason,
            },
          },
          ctx,
        );

        return summary;
      });

      return summary;
    } catch (error) {
      // El IntegrationCommand permanece REQUESTED — no se promete
      // recuperación automática, solo manual (un nuevo intento de
      // publicación reutiliza este mismo registro por idempotencyKey).
      await this.templates.update(template.id, { status: 'PUBLISH_FAILED' }).catch(() => undefined);
      throw error;
    }
  }
}
