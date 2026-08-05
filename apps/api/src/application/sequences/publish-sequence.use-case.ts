import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MAILBOX_MOTOR_PORT, MailboxMotorPort } from '../../domain/mailbox-motor/mailbox-motor-port';
import { TransactionManager } from '../../domain/persistence/transaction';
import { SequencePublishStatus } from '../../domain/sequence/sequence.entity';
import { SequenceStepVersionRepository } from '../../domain/sequence/sequence-step-version.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import {
  AUDIT_LOG_REPOSITORY,
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SEQUENCE_STEP_VERSION_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  TRANSACTION_MANAGER,
} from '../../infrastructure/persistence/tokens';
import { isUniqueConstraintViolation } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import { PublishScenario, SimulatedMailEngineAdapter } from '../../infrastructure/mail-engine/simulated/simulated-mail-engine-adapter';
import { ClientEligibilityService } from '../clients/client-eligibility.service';
import { IDEMPOTENCY_SCOPE, IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { hashLogicalPayload } from '../idempotency/payload-canonicalizer';
import { IntegrationService } from '../integration/integration.service';
import { computeEffectiveStart } from './sequence-timing.util';

const TRANSACTION_TIMEOUT_MS = 10_000;

/** Fase 2, Caso C — a publish already in flight blocks a second concurrent attempt on the same sequence; every other status is a valid claim-from state (including ACTIVE — re-publishing to push edited content is a supported action). */
const BLOCKED_PUBLISH_STATUSES: SequencePublishStatus[] = ['REQUESTED', 'ACCEPTED', 'PROCESSING', 'SCHEDULED'];

export interface PublishSequenceInput {
  organizationId: string;
  sequenceId: string;
  actorId: string;
  idempotencyKey: string;
  correlationId?: string;
  /** QA hook carried over from the old SequencePublishService — forces the simulated engine's outcome; never persisted. */
  scenario?: PublishScenario;
}

export interface PublishSequenceResult {
  sequenceId: string;
  publishStatus: SequencePublishStatus | null;
  sequenceVersion: number;
  effectiveStartAt: string | null;
  lastPublishedAt: string | null;
  commandId: string;
  commandStatus: string;
  correlationId: string;
}

/**
 * Fase 2, Caso C — replaces SequencePublishService.publish(): the command
 * row, its audit entry, and the sequence's `publishStatus`/
 * `lastPublishCommandId` transition to REQUESTED now commit together in one
 * PostgreSQL transaction (previously two independent, non-transactional
 * calls with no rollback safety). Idempotency-Key is a required header
 * (never a client-supplied body field, never server-generated) — a retry
 * with the same key+content returns the persisted result; a different
 * idempotency key on the same sequence while a publish is already in
 * flight (REQUESTED/ACCEPTED/PROCESSING/SCHEDULED) is rejected with 409 by
 * `conditionalUpdatePublishStatus`'s atomic claim.
 *
 * Dispatch to the (simulated) engine and driving it to its terminal event
 * happen strictly AFTER commit, as a best-effort step — mirroring Casos
 * A/B: a dispatch/advance failure never reverts the already-committed
 * REQUESTED state, and `sequenceVersion`/`lastPublishedAt`/
 * `effectiveStartAt` are only written once the engine actually reports
 * SEQUENCE_PUBLISH_COMPLETED (matching the pre-existing, still-relied-upon
 * contract: a FAILED-scenario publish must leave `sequenceVersion`
 * unbumped — see sequence-wizard.e2e-spec.ts).
 *
 * CRM eligibility is resolved via the sender mailbox's `clientId` rather
 * than `sequence.clientId` — historically because the Postgres driver never
 * persisted the latter (see the sequence-client-id migration; both are now
 * real, kept-in-sync columns), and kept this way since `mailbox.clientId`
 * is the actual source of truth `sequence.clientId` is denormalized from.
 * Scope note: this intentionally checks CRM-active-client only (the
 * same narrow check the old code made), not the fuller
 * SequenceEligibilityService (executive-assigned-to-client/domain-active/
 * mailbox-connected) — routing publish through the fuller check would be a
 * behavior change no current test exercises or requires, and several
 * existing e2e sequences never wire up mailbox connectivity/testing before
 * publishing. Left as a documented, deliberate scope boundary.
 */
@Injectable()
export class PublishSequenceUseCase {
  constructor(
    @Inject(TRANSACTION_MANAGER) private readonly tx: TransactionManager,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly steps: SequenceStepRepository,
    @Inject(SEQUENCE_STEP_VERSION_REPOSITORY) private readonly stepVersions: SequenceStepVersionRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY) private readonly signatureVersions: SignatureVersionRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly eligibility: ClientEligibilityService,
    private readonly idempotency: IdempotentOperationService,
    private readonly integration: IntegrationService,
    private readonly simulatedAdapter: SimulatedMailEngineAdapter,
    @Inject(MAILBOX_MOTOR_PORT) private readonly motor: MailboxMotorPort,
  ) {}

  async execute(input: PublishSequenceInput): Promise<{ result: PublishSequenceResult; httpStatus: number }> {
    const sequence = await this.sequences.findById(input.sequenceId);
    if (!sequence || sequence.organizationId !== input.organizationId) {
      throw new NotFoundException('Sequence not found.');
    }
    if (!sequence.mailboxId) {
      throw new ConflictException('La secuencia necesita una cuenta remitente antes de publicarse.');
    }
    const mailbox = await this.mailboxes.findById(sequence.mailboxId);
    if (!mailbox) {
      throw new NotFoundException('Sender mailbox not found.');
    }

    // Fase 2.1, §15 — fail-closed, BEFORE the local publish transaction
    // opens: for a SERVER_TOKEN mailbox, the motor is queried live every
    // time; the last-known local snapshot is never used to authorize a new
    // publish. A 503 from the port propagates as-is (never treated as "ok").
    if (mailbox.linkSource === 'SERVER_TOKEN') {
      await this.assertServerMailboxEligible(mailbox);
    }

    const activeSteps = (await this.steps.findBySequence(sequence.id))
      .filter((step) => step.status !== 'ARCHIVED')
      .sort((a, b) => a.position - b.position);
    if (activeSteps.length === 0) {
      throw new ConflictException('La secuencia necesita al menos un step antes de publicarse.');
    }

    const stepsForHash = await Promise.all(
      activeSteps.map(async (step) => {
        const versions = await this.stepVersions.findByStep(step.id);
        return {
          stepId: step.id,
          name: step.name,
          position: step.position,
          subject: step.subject,
          htmlHeader: step.htmlHeader,
          htmlBody: step.htmlBody,
          plainTextBody: step.plainTextBody,
          delayValue: step.delayValue,
          delayUnit: step.delayUnit,
          versionNumber: versions[0]?.versionNumber ?? 1,
        };
      }),
    );

    const payloadHash = hashLogicalPayload({
      sequenceId: sequence.id,
      mailboxId: sequence.mailboxId,
      managementDate: sequence.managementDate,
      timezone: sequence.timezone,
      schedule: sequence.schedule,
      policies: sequence.policies,
      steps: stepsForHash,
    });

    const existing = await this.idempotency.checkExisting(
      input.organizationId,
      IDEMPOTENCY_SCOPE.SEQUENCE_PUBLISH,
      input.idempotencyKey,
      payloadHash,
    );
    if (existing) {
      return {
        result: existing.resultSnapshot as unknown as PublishSequenceResult,
        httpStatus: existing.httpStatusCode ?? 201,
      };
    }

    // Only gated when the sender mailbox is actually linked to a client — a
    // mailbox "Pendiente de clasificación" (no clientId) publishes without a
    // client-eligibility check, same as the old code's `if (sequence.clientId)` guard.
    if (mailbox.clientId) {
      const managedClient = await this.managedClients.findById(mailbox.clientId);
      if (managedClient) {
        await this.eligibility.assertEligibleForPublish(managedClient);
      }
    }

    const requestedAt = new Date();
    const effectiveStartAt = sequence.managementDate
      ? computeEffectiveStart(sequence.managementDate, requestedAt, sequence.schedule, sequence.timezone)
      : requestedAt;
    const nextVersion = sequence.sequenceVersion + 1;

    const signature = await this.signatures.findByMailbox(mailbox.id);
    const signatureVersion = signature?.activeVersionId ? await this.signatureVersions.findById(signature.activeVersionId) : null;

    const enrolledContacts = await this.sequenceContacts.findBySequence(input.organizationId, sequence.id);
    const companyIds = [...new Set(enrolledContacts.map((c) => c.companyId).filter((id): id is string => !!id))];
    const contactIds = [...new Set(enrolledContacts.map((c) => c.contactId))];
    const [companyRows, contactRows] = await Promise.all([
      this.companies.findManyByIds(companyIds),
      this.contacts.findManyByIds(contactIds),
    ]);
    const companiesById = new Map(companyRows.map((c) => [c.id, c]));
    const contactsById = new Map(contactRows.map((c) => [c.id, c]));

    const byCompany = new Map<string, { companyId: string | null; companyName: string; contacts: Array<Record<string, unknown>> }>();
    for (const enrollment of enrolledContacts) {
      const contact = contactsById.get(enrollment.contactId);
      if (!contact) continue;
      const company = enrollment.companyId ? companiesById.get(enrollment.companyId) : null;
      const groupKey = enrollment.companyId ?? `contact:${contact.id}`;
      if (!byCompany.has(groupKey)) {
        byCompany.set(groupKey, {
          companyId: enrollment.companyId,
          companyName: company?.rawName ?? 'Sin empresa asociada',
          contacts: [],
        });
      }
      const fullName = contact.firstName ?? contact.email;
      byCompany.get(groupKey)!.contacts.push({
        contactId: contact.id,
        name: fullName,
        email: contact.email,
        variables: {
          empresa: company?.rawName ?? '',
          nombre_contacto: contact.firstName ?? fullName,
          correo_contacto: contact.email,
        },
        initialStepCode: activeSteps[0].name,
      });
    }

    const commandPayload = {
      sequenceId: sequence.id,
      sequenceVersion: nextVersion,
      displayName: sequence.name,
      managementDate: sequence.managementDate,
      clientId: mailbox.clientId,
      domainId: mailbox.domainId,
      executiveId: sequence.executiveId,
      mailboxId: sequence.mailboxId,
      timezone: sequence.timezone,
      startPolicy: {
        requestedDate: sequence.managementDate,
        effectiveStartAt: effectiveStartAt.toISOString(),
      },
      sendingWindow: {
        daysOfWeek: sequence.schedule.days,
        startTime: sequence.schedule.windows[0]?.start ?? null,
        endTime: sequence.schedule.windows[0]?.end ?? null,
        timezone: sequence.timezone,
      },
      policies: sequence.policies,
      steps: stepsForHash.map((step) => ({
        stepCode: step.name,
        order: step.position,
        trigger:
          step.position === 1
            ? { type: 'SEQUENCE_START' as const }
            : {
                type: 'AFTER_STEP_SENT' as const,
                afterStepCode: activeSteps[step.position - 2]?.name ?? null,
                delay: { value: step.delayValue, unit: step.delayUnit },
              },
        subjectSourceStepCode: step.position === 1 ? null : activeSteps[0].name,
        subjectTemplate: step.position === 1 ? step.subject : null,
        headerHtml: step.htmlHeader,
        htmlBody: step.htmlBody,
        textBody: step.plainTextBody,
        version: step.versionNumber,
      })),
      variableMappings: [
        { variable: 'empresa', sourceColumn: null },
        { variable: 'nombre_contacto', sourceColumn: null },
        { variable: 'correo_contacto', sourceColumn: null },
      ],
      prospects: Array.from(byCompany.values()).map((group) => ({
        prospectId: group.companyId,
        companyName: group.companyName,
        contacts: group.contacts,
      })),
      signature: signature && signatureVersion ? { signatureId: signature.id, versionId: signatureVersion.id } : null,
    };

    try {
      const { result, command } = await this.tx.run(
        async (ctx) => {
          const claimedCount = await this.sequences.conditionalUpdatePublishStatus(
            sequence.id,
            BLOCKED_PUBLISH_STATUSES,
            'REQUESTED',
            ctx,
          );
          if (claimedCount !== 1) {
            throw new ConflictException('Esta secuencia ya tiene una publicación en curso.');
          }

          const correlationId = input.correlationId ?? `corr_${sequence.id}`;
          const commandId = `cmd_${randomUUID()}`;

          const updatedSequence = await this.sequences.update(
            sequence.id,
            { lastPublishCommandId: commandId, updatedBy: input.actorId },
            ctx,
          );

          await this.auditLogs.record(
            {
              organizationId: input.organizationId,
              actorId: input.actorId,
              action: 'sequence.publish_requested',
              entityType: 'Sequence',
              entityId: sequence.id,
              metadata: { correlationId, idempotencyKey: input.idempotencyKey, commandId, nextVersion },
            },
            ctx,
          );

          const result: PublishSequenceResult = {
            sequenceId: updatedSequence.id,
            publishStatus: 'REQUESTED',
            sequenceVersion: updatedSequence.sequenceVersion,
            effectiveStartAt: null,
            lastPublishedAt: null,
            commandId,
            commandStatus: 'REQUESTED',
            correlationId,
          };

          const command = await this.idempotency.claim(
            ctx,
            {
              organizationId: input.organizationId,
              scope: IDEMPOTENCY_SCOPE.SEQUENCE_PUBLISH,
              rawIdempotencyKey: input.idempotencyKey,
              payloadHash,
              commandType: 'SEQUENCE_PUBLISH_REQUESTED',
              aggregateType: 'SEQUENCE',
              aggregateId: sequence.id,
              correlationId,
              requestedBy: input.actorId,
              commandPayload,
              commandId,
            },
            result as unknown as Record<string, unknown>,
            201,
          );

          return { result, command };
        },
        { timeoutMs: TRANSACTION_TIMEOUT_MS },
      );

      try {
        if (input.scenario) {
          this.simulatedAdapter.setPublishScenario(command.commandId, input.scenario);
        }
        const dispatched = await this.integration.dispatchExistingCommand(command, input.actorId);
        result.commandStatus = dispatched.status;
        const events = await this.integration.advance(input.organizationId, command.commandId, 'ALL', input.actorId);
        await this.applyTerminalEvent(input.organizationId, sequence.id, events, nextVersion, effectiveStartAt, input.actorId, result);
        await this.idempotency.refreshResultSnapshot(command.id, result as unknown as Record<string, unknown>);
      } catch (dispatchError) {
        console.error(
          JSON.stringify({
            event: 'publish_sequence.dispatch_failed',
            correlationId: result.correlationId,
            commandId: result.commandId,
            organizationId: input.organizationId,
            message: dispatchError instanceof Error ? dispatchError.message : 'unknown error',
          }),
        );
      }

      return { result, httpStatus: 201 };
    } catch (error) {
      if (error instanceof ConflictException || isUniqueConstraintViolation(error)) {
        const raced = await this.idempotency.checkExisting(
          input.organizationId,
          IDEMPOTENCY_SCOPE.SEQUENCE_PUBLISH,
          input.idempotencyKey,
          payloadHash,
        );
        if (raced) {
          return {
            result: raced.resultSnapshot as unknown as PublishSequenceResult,
            httpStatus: raced.httpStatusCode ?? 201,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Applies the engine's reported outcome — best-effort, non-transactional,
   * exactly mirroring the old SequencePublishService.applyEvents timing:
   * `sequenceVersion`/`lastPublishedAt`/`effectiveStartAt` are only ever
   * written once SEQUENCE_PUBLISH_COMPLETED actually lands.
   */
  private async applyTerminalEvent(
    organizationId: string,
    sequenceId: string,
    events: Array<{ eventType: string; commandId: string | null }>,
    nextVersion: number,
    effectiveStartAt: Date,
    actorId: string,
    result: PublishSequenceResult,
  ): Promise<void> {
    for (const event of events) {
      switch (event.eventType) {
        case 'SEQUENCE_PUBLISH_ACCEPTED':
          await this.sequences.update(sequenceId, { publishStatus: 'ACCEPTED', updatedBy: actorId });
          result.publishStatus = 'ACCEPTED';
          await this.auditLogs.record({
            organizationId,
            actorId,
            action: 'sequence.publish_accepted',
            entityType: 'Sequence',
            entityId: sequenceId,
            metadata: { commandId: event.commandId },
          });
          break;
        case 'SEQUENCE_PUBLISH_COMPLETED': {
          const updated = await this.sequences.update(sequenceId, {
            publishStatus: 'ACTIVE',
            sequenceVersion: nextVersion,
            lastPublishedAt: new Date(),
            effectiveStartAt,
            updatedBy: actorId,
          });
          result.publishStatus = 'ACTIVE';
          result.sequenceVersion = updated.sequenceVersion;
          result.lastPublishedAt = updated.lastPublishedAt?.toISOString() ?? null;
          result.effectiveStartAt = updated.effectiveStartAt?.toISOString() ?? null;
          await this.auditLogs.record({
            organizationId,
            actorId,
            action: 'sequence.publish_completed',
            entityType: 'Sequence',
            entityId: sequenceId,
            metadata: { commandId: event.commandId },
          });
          break;
        }
        case 'SEQUENCE_PUBLISH_FAILED':
          await this.sequences.update(sequenceId, { publishStatus: 'FAILED', updatedBy: actorId });
          result.publishStatus = 'FAILED';
          await this.auditLogs.record({
            organizationId,
            actorId,
            action: 'sequence.publish_failed',
            entityType: 'Sequence',
            entityId: sequenceId,
            metadata: { commandId: event.commandId },
          });
          break;
        default:
          break;
      }
    }
  }

  /**
   * Fase 2.1, §15 — validates a SERVER_TOKEN mailbox against the motor,
   * live, and refreshes the local snapshot regardless of outcome (so the
   * snapshot always reflects the last real check, never a stale "ok").
   * Throws 503 (propagated from the port) if the motor is unreachable,
   * 409 if the link isn't ACTIVE/can't send/isn't technically CONNECTED.
   */
  private async assertServerMailboxEligible(mailbox: Mailbox): Promise<void> {
    if (!mailbox.serverMailboxId) {
      throw new ConflictException('Esta cuenta vinculada por token no tiene un identificador de servidor válido.');
    }
    const status = await this.motor.getMailboxStatus(mailbox.serverMailboxId);

    await this.mailboxes.update(mailbox.id, {
      linkStatus: status.linkStatus === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
      serverStatusSnapshot: status.technicalStatus,
      serverCanSendSnapshot: status.canSend,
      serverStatusCheckedAt: status.checkedAt,
    });

    if (status.linkStatus !== 'ACTIVE') {
      throw new ConflictException('Esta cuenta fue revocada o desvinculada; no puede usarse para publicar.');
    }
    if (!status.canSend || status.technicalStatus !== 'CONNECTED') {
      throw new ConflictException('Esta cuenta no está en condiciones técnicas de enviar correos en este momento.');
    }
    if (mailbox.status !== 'ACTIVE') {
      throw new ConflictException('Esta cuenta está desactivada en Mr Outreach.');
    }
  }
}
