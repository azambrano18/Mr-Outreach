import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { IntegrationCommand } from '../../domain/integration/integration-command.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
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
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SEQUENCE_STEP_VERSION_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { SimulatedMailEngineAdapter, PublishScenario } from '../../infrastructure/mail-engine/simulated/simulated-mail-engine-adapter';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { ClientsService } from '../clients/clients.service';
import { IntegrationService } from '../integration/integration.service';
import { computeEffectiveStart } from './sequence-timing.util';

/**
 * §14-16/§22-23 — "Publicar secuencia". Kept separate from SequencesService
 * (which owns the DRAFT/PAUSED/ARCHIVED editing lifecycle, unchanged) — this
 * service turns a publish click into a SEQUENCE_PUBLISH_REQUESTED command
 * whose payload is the full contract from §22 (schedule, effective start,
 * steps, variable mappings, enrolled prospects/contacts, and a frozen
 * signature reference), advances it to completion synchronously (publish's
 * planned events are all near-instant — no separate manual-advance control
 * like mailbox provisioning has), and reacts to whichever terminal event the
 * simulated engine reports: COMPLETED bumps `sequenceVersion`/
 * `lastPublishedAt`/`effectiveStartAt`; FAILED/TIMEOUT leave the sequence's
 * last-published state untouched so a retry (a fresh call, its own
 * idempotencyKey) never duplicates anything (§23 — "no duplicar la
 * secuencia... permitir reintentar... mantener el borrador").
 */
@Injectable()
export class SequencePublishService {
  constructor(
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly steps: SequenceStepRepository,
    @Inject(SEQUENCE_STEP_VERSION_REPOSITORY) private readonly stepVersions: SequenceStepVersionRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY) private readonly signatureVersions: SignatureVersionRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly integration: IntegrationService,
    private readonly simulatedAdapter: SimulatedMailEngineAdapter,
    private readonly config: AppConfigService,
    private readonly clients: ClientsService,
  ) {}

  async publish(
    organizationId: string,
    sequenceId: string,
    actorId: string,
    idempotencyKey?: string,
    scenario?: PublishScenario,
  ): Promise<{ sequence: Sequence; command: IntegrationCommand; duplicate: boolean }> {
    const sequence = await this.getOwnedSequence(organizationId, sequenceId);
    // Fase 1.5 §9 — publishing creates real scheduled activity; gate it the
    // same way as creation. `clientId` is nullable on Sequence (only wizard-
    // created sequences have one) — nothing to check against otherwise.
    if (sequence.clientId) {
      await this.clients.assertClientCrmEligible(organizationId, sequence.clientId, actorId);
    }
    if (!sequence.mailboxId) {
      throw new ConflictException('La secuencia necesita una cuenta remitente antes de publicarse.');
    }
    const mailbox = await this.mailboxes.findById(sequence.mailboxId);
    if (!mailbox) {
      throw new NotFoundException('Sender mailbox not found.');
    }

    const activeSteps = (await this.steps.findBySequence(sequence.id))
      .filter((step) => step.status !== 'ARCHIVED')
      .sort((a, b) => a.position - b.position);
    if (activeSteps.length === 0) {
      throw new ConflictException('La secuencia necesita al menos un step antes de publicarse.');
    }

    const requestedAt = new Date();
    const effectiveStartAt = sequence.managementDate
      ? computeEffectiveStart(sequence.managementDate, requestedAt, sequence.schedule, sequence.timezone)
      : requestedAt;

    const stepsPayload = await Promise.all(
      activeSteps.map(async (step) => {
        const versions = await this.stepVersions.findByStep(step.id);
        return {
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
          version: versions[0]?.versionNumber ?? 1,
        };
      }),
    );

    const signature = await this.signatures.findByMailbox(mailbox.id);
    const signatureVersion =
      signature?.activeVersionId ? await this.signatureVersions.findById(signature.activeVersionId) : null;

    const enrolledContacts = await this.sequenceContacts.findBySequence(organizationId, sequence.id);
    const byCompany = new Map<string, { companyId: string | null; companyName: string; contacts: Array<Record<string, unknown>> }>();
    for (const enrollment of enrolledContacts) {
      const contact = await this.contacts.findById(enrollment.contactId);
      if (!contact) continue;
      const company = enrollment.companyId ? await this.companies.findById(enrollment.companyId) : null;
      const groupKey = enrollment.companyId ?? `contact:${contact.id}`;
      if (!byCompany.has(groupKey)) {
        byCompany.set(groupKey, {
          companyId: enrollment.companyId,
          companyName: company?.rawName ?? 'Sin empresa asociada',
          contacts: [],
        });
      }
      const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email;
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

    const nextVersion = sequence.sequenceVersion + 1;
    const payload = {
      sequenceId: sequence.id,
      sequenceVersion: nextVersion,
      displayName: sequence.name,
      managementDate: sequence.managementDate,
      clientId: sequence.clientId,
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
      steps: stepsPayload,
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

    const { command, duplicate } = await this.integration.submit(
      {
        organizationId,
        commandType: 'SEQUENCE_PUBLISH_REQUESTED',
        aggregateType: 'SEQUENCE',
        aggregateId: sequence.id,
        payload,
        requestedBy: actorId,
        idempotencyKey: idempotencyKey ?? `sequence-publish:${sequence.id}:${randomUUID()}`,
      },
      actorId,
    );

    if (!duplicate) {
      if (scenario) {
        this.simulatedAdapter.setPublishScenario(command.commandId, scenario);
      }
      // Recorded regardless of outcome, so the "ver JSON" viewer can show a failed attempt too.
      await this.sequences.update(sequence.id, {
        publishStatus: 'REQUESTED',
        lastPublishCommandId: command.commandId,
        updatedBy: actorId,
      });
      const events = await this.integration.advance(organizationId, command.commandId, 'ALL', actorId);
      await this.applyEvents(organizationId, sequence, events, nextVersion, effectiveStartAt, actorId);
    }

    return { sequence: await this.getOwnedSequence(organizationId, sequenceId), command, duplicate };
  }

  /** §22 — the authentication block's signature is always generated server-side, never in the browser. */
  signCommand(commandId: string, timestamp: string, nonce: string): string {
    return createHmac('sha256', Buffer.from(this.config.credentialsEncryptionKey, 'base64'))
      .update(`${commandId}.${timestamp}.${nonce}`)
      .digest('hex');
  }

  /** Spec §8 — "cambios de estado informados por el motor" audited here, never the payload/credentials. */
  private async applyEvents(
    organizationId: string,
    sequence: Sequence,
    events: IntegrationEvent[],
    nextVersion: number,
    effectiveStartAt: Date,
    actorId: string,
  ): Promise<void> {
    for (const event of events) {
      switch (event.eventType) {
        case 'SEQUENCE_PUBLISH_ACCEPTED':
          await this.sequences.update(sequence.id, { publishStatus: 'ACCEPTED', updatedBy: actorId });
          await this.auditLogs.record({
            organizationId,
            actorId,
            action: 'sequence.publish_accepted',
            entityType: 'Sequence',
            entityId: sequence.id,
            metadata: { commandId: event.commandId },
          });
          break;
        case 'SEQUENCE_PUBLISH_COMPLETED':
          await this.sequences.update(sequence.id, {
            publishStatus: 'ACTIVE',
            sequenceVersion: nextVersion,
            lastPublishedAt: new Date(),
            effectiveStartAt,
            updatedBy: actorId,
          });
          await this.auditLogs.record({
            organizationId,
            actorId,
            action: 'sequence.publish_completed',
            entityType: 'Sequence',
            entityId: sequence.id,
            metadata: { commandId: event.commandId },
          });
          break;
        case 'SEQUENCE_PUBLISH_FAILED':
          await this.sequences.update(sequence.id, { publishStatus: 'FAILED', updatedBy: actorId });
          await this.auditLogs.record({
            organizationId,
            actorId,
            action: 'sequence.publish_failed',
            entityType: 'Sequence',
            entityId: sequence.id,
            metadata: { commandId: event.commandId },
          });
          break;
        default:
          break;
      }
    }
  }

  private async getOwnedSequence(organizationId: string, sequenceId: string): Promise<Sequence> {
    const sequence = await this.sequences.findById(sequenceId);
    if (!sequence || sequence.organizationId !== organizationId) {
      throw new NotFoundException('Sequence not found.');
    }
    return sequence;
  }
}
