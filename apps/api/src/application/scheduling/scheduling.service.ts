import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { CANCELLABLE_SCHEDULED_EMAIL_STATUSES, ScheduledEmail } from '../../domain/scheduled-email/scheduled-email.entity';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContact } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { DelayUnit, SequenceStep } from '../../domain/sequence/sequence-step.entity';
import { SequenceStepVersionRepository } from '../../domain/sequence/sequence-step-version.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SEQUENCE_STEP_VERSION_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { addBusinessDays } from '../sequences/sequence-timing.util';

export interface BatchResult {
  batchId: string;
  followUps: number;
  newContacts: number;
  total: number;
  scheduledEmails: ScheduledEmail[];
}

const CANCELLABLE_STATUSES = CANCELLABLE_SCHEDULED_EMAIL_STATUSES;

/**
 * §21-27 — auto-enrollment into the first published step, batching/limits
 * with follow-ups prioritized ahead of new contacts (§23), simulated send
 * with Message-ID/threading (§31-32), and future-job cancellation for the
 * "retirar contacto/empresa" flows (§27-28). No real timers/queues — a
 * batch is a synchronous computation triggered by an explicit "Crear
 * lote"/"Programar" click, and a send is a synchronous "Simular envío"
 * click, matching this whole phase's simulation-first scope.
 */
@Injectable()
export class SchedulingService {
  constructor(
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly steps: SequenceStepRepository,
    @Inject(SEQUENCE_STEP_VERSION_REPOSITORY)
    private readonly stepVersions: SequenceStepVersionRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  /**
   * §21 — contacts accepted by an import enter the sequence's first
   * PUBLISHED step automatically; no manual per-contact assignment exists.
   * Returns `firstStep: null` when there is nothing published yet — the
   * caller (SequenceImportsService) must treat that as import failure,
   * never as "completed with zero contacts".
   */
  async enrollAcceptedContacts(
    organizationId: string,
    sequence: Sequence,
    acceptedRows: Array<{ contactId: string; companyId: string | null }>,
    sourceImportId?: string,
  ): Promise<{ enrolled: SequenceContact[]; firstStep: SequenceStep | null }> {
    if (!sequence.mailboxId || !sequence.clientId) return { enrolled: [], firstStep: null };

    const allSteps = (await this.steps.findBySequence(sequence.id)).sort((a, b) => a.position - b.position);
    const firstStep = allSteps.find((step) => step.status === 'PUBLISHED') ?? null;
    if (!firstStep) return { enrolled: [], firstStep: null };

    const enrolled: SequenceContact[] = [];
    for (const row of acceptedRows) {
      const existing = await this.sequenceContacts.findByContactAndSequence(sequence.id, row.contactId);
      if (existing) continue;
      const created = await this.sequenceContacts.create({
        organizationId,
        clientId: sequence.clientId,
        sequenceId: sequence.id,
        sequenceVersion: sequence.sequenceVersion,
        contactId: row.contactId,
        companyId: row.companyId,
        sourceImportId,
        assignedMailboxId: sequence.mailboxId,
        assignedExecutiveId: sequence.executiveId,
        currentStepId: firstStep.id,
        currentStepPosition: firstStep.position,
      });
      enrolled.push(created);
    }
    return { enrolled, firstStep };
  }

  /**
   * §23-25 — "Crear lote"/"Programar Envío N": schedules a ScheduledEmail
   * for every ACTIVE contact whose current step has no job yet, capped at
   * the sender mailbox's daily limit, follow-ups (position > 1) sorted
   * ahead of brand-new contacts. §22 — each contact's scheduledAt is
   * computed from ITS OWN previous send (`lastSentAt` + the step's delay),
   * never from "now"/import date.
   */
  async createBatch(organizationId: string, sequenceId: string, actorId: string): Promise<BatchResult> {
    const activeContacts = await this.sequenceContacts.findBySequence(organizationId, sequenceId, {
      status: 'ACTIVE',
    });
    const dueContacts = activeContacts.filter((contact) => contact.currentStepId);

    const pending: SequenceContact[] = [];
    for (const contact of dueContacts) {
      const existing = await this.scheduledEmails.findBySequenceContact(contact.id);
      const alreadyScheduled = existing.some(
        (row) => row.sequenceStepId === contact.currentStepId && row.status !== 'CANCELLED',
      );
      if (!alreadyScheduled) pending.push(contact);
    }
    if (pending.length === 0) {
      return { batchId: '', followUps: 0, newContacts: 0, total: 0, scheduledEmails: [] };
    }

    // §23 — "Priorizar follow-ups antes que prospectos nuevos."
    pending.sort((a, b) => (b.currentStepPosition ?? 0) - (a.currentStepPosition ?? 0));

    const mailbox = await this.mailboxes.findById(pending[0].assignedMailboxId);
    if (!mailbox) throw new NotFoundException('Sender mailbox not found.');
    const sequence = await this.sequences.findById(sequenceId);
    const timezone = sequence?.timezone ?? 'America/Santiago';

    const capped = pending.slice(0, mailbox.sendingLimits.dailyLimit);
    const batchId = `batch_${randomUUID()}`;
    const created: ScheduledEmail[] = [];
    let followUps = 0;
    let cursor = new Date();

    for (const contact of capped) {
      const step = await this.steps.findById(contact.currentStepId as string);
      if (!step) continue;
      const versions = await this.stepVersions.findByStep(step.id);
      const stepVersion = versions[0]?.versionNumber ?? 1;
      const isFollowUp = (contact.currentStepPosition ?? 1) > 1;
      if (isFollowUp) followUps += 1;

      const earliestFromDelay = contact.lastSentAt
        ? step.delayUnit === 'BUSINESS_DAYS'
          ? addBusinessDays(contact.lastSentAt, step.delayValue, timezone)
          : new Date(contact.lastSentAt.getTime() + this.delayToMs(step.delayValue, step.delayUnit))
        : new Date();
      const scheduledAt = new Date(Math.max(earliestFromDelay.getTime(), cursor.getTime()));
      cursor = new Date(scheduledAt.getTime() + mailbox.sendingLimits.minimumIntervalSeconds * 1000);

      const scheduledEmail = await this.scheduledEmails.create({
        organizationId,
        sequenceId,
        sequenceVersion: contact.sequenceVersion,
        sequenceContactId: contact.id,
        contactId: contact.contactId,
        companyId: contact.companyId,
        sequenceStepId: step.id,
        stepVersion,
        mailboxId: mailbox.id,
        batchId,
        scheduledAt,
        priority: isFollowUp ? 'FOLLOW_UP' : 'NEW_CONTACT',
        idempotencyKey: `scheduled-email:${contact.id}:${step.id}:${stepVersion}`,
      });
      created.push(scheduledEmail);
      await this.sequenceContacts.update(contact.id, { status: 'SCHEDULED', nextScheduledAt: scheduledAt });
    }

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'scheduled_email.batch_create',
      entityType: 'Sequence',
      entityId: sequenceId,
      metadata: {
        batchId,
        total: created.length,
        followUps,
        newContacts: created.length - followUps,
      },
    });

    return {
      batchId,
      followUps,
      newContacts: created.length - followUps,
      total: created.length,
      scheduledEmails: created,
    };
  }

  /** §24-25/§31-32 — "Simular envío". Snapshots the message, assigns Message-ID/threading, advances the contact to its next step (or COMPLETED). */
  async simulateSend(
    organizationId: string,
    scheduledEmailId: string,
    actorId: string,
    outcome: 'SENT' | 'RETRY' | 'FAILED' = 'SENT',
  ): Promise<ScheduledEmail> {
    const scheduledEmail = await this.getOwnedScheduledEmail(organizationId, scheduledEmailId);

    if (outcome === 'FAILED') {
      const updated = await this.scheduledEmails.update(scheduledEmail.id, {
        status: 'FAILED',
        lastError: 'Fallo simulado de envío.',
        attemptCount: scheduledEmail.attemptCount + 1,
      });
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'scheduled_email.simulate_failed',
        entityType: 'ScheduledEmail',
        entityId: scheduledEmail.id,
      });
      return updated;
    }
    if (outcome === 'RETRY') {
      const updated = await this.scheduledEmails.update(scheduledEmail.id, {
        status: 'RETRY_SCHEDULED',
        attemptCount: scheduledEmail.attemptCount + 1,
      });
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'scheduled_email.simulate_retry',
        entityType: 'ScheduledEmail',
        entityId: scheduledEmail.id,
      });
      return updated;
    }

    const contact = await this.sequenceContacts.findById(scheduledEmail.sequenceContactId);
    if (!contact) throw new NotFoundException('Sequence contact not found.');
    const step = await this.steps.findById(scheduledEmail.sequenceStepId);
    if (!step) throw new NotFoundException('Sequence step not found.');

    const sentAt = new Date();
    const messageIdHeader = `<outbound_${scheduledEmail.id.slice(0, 8)}@mailengine.mroutreach.local>`;
    const priorSent = (await this.scheduledEmails.findBySequenceContact(contact.id))
      .filter((row) => row.status === 'SENT' && row.messageIdHeader)
      .sort((a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0));
    const previous = priorSent[priorSent.length - 1];

    const updated = await this.scheduledEmails.update(scheduledEmail.id, {
      status: 'SENT',
      sentAt,
      subjectSnapshot: step.subject,
      htmlBodySnapshot: step.htmlBody,
      plainTextBodySnapshot: step.plainTextBody,
      messageIdHeader,
      inReplyTo: previous?.messageIdHeader ?? null,
      referencesHeader: previous
        ? [previous.referencesHeader, previous.messageIdHeader].filter(Boolean).join(' ')
        : null,
    });

    const allSteps = (await this.steps.findBySequence(scheduledEmail.sequenceId))
      .filter((candidate) => candidate.status !== 'ARCHIVED')
      .sort((a, b) => a.position - b.position);
    const currentIndex = allSteps.findIndex((candidate) => candidate.id === step.id);
    const nextStep = currentIndex >= 0 ? (allSteps[currentIndex + 1] ?? null) : null;

    await this.sequenceContacts.update(contact.id, {
      lastSentAt: sentAt,
      nextScheduledAt: null,
      status: nextStep ? 'ACTIVE' : 'COMPLETED',
      currentStepId: nextStep?.id ?? null,
      currentStepPosition: nextStep?.position ?? null,
      ...(nextStep ? {} : { completedAt: sentAt }),
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'scheduled_email.simulate_sent',
      entityType: 'ScheduledEmail',
      entityId: scheduledEmail.id,
      metadata: { messageIdHeader },
    });

    return updated;
  }

  /**
   * "Deriva" — sends the new contact's first step right now, deliberately
   * isolated from `createBatch` (which would sweep in every OTHER contact
   * due for a send in this sequence, not just this one). Creates a single
   * `ScheduledEmail` for the contact's current step with `scheduledAt: now`
   * and immediately calls `simulateSend` on it — consistent with this
   * whole phase's simulation model, where a "send" is always a synchronous,
   * explicit action rather than something a background worker picks up.
   */
  async sendFirstStepNow(
    organizationId: string,
    sequenceContact: SequenceContact,
    actorId: string,
  ): Promise<ScheduledEmail> {
    if (!sequenceContact.currentStepId) {
      throw new NotFoundException('Este contacto no tiene un step actual asignado.');
    }
    const step = await this.steps.findById(sequenceContact.currentStepId);
    if (!step) throw new NotFoundException('Sequence step not found.');
    const versions = await this.stepVersions.findByStep(step.id);
    const stepVersion = versions[0]?.versionNumber ?? 1;
    const scheduledAt = new Date();

    const scheduledEmail = await this.scheduledEmails.create({
      organizationId,
      sequenceId: sequenceContact.sequenceId,
      sequenceVersion: sequenceContact.sequenceVersion,
      sequenceContactId: sequenceContact.id,
      contactId: sequenceContact.contactId,
      companyId: sequenceContact.companyId,
      sequenceStepId: step.id,
      stepVersion,
      mailboxId: sequenceContact.assignedMailboxId,
      batchId: `immediate_${randomUUID()}`,
      scheduledAt,
      priority: 'NEW_CONTACT',
      idempotencyKey: `scheduled-email:${sequenceContact.id}:${step.id}:${stepVersion}`,
    });

    return this.simulateSend(organizationId, scheduledEmail.id, actorId);
  }

  /** §27 — cancels every not-yet-sent job for one contact; sent messages/history are untouched. */
  async cancelFutureJobsForContact(
    organizationId: string,
    sequenceContactId: string,
    reason: string,
  ): Promise<number> {
    const rows = await this.scheduledEmails.findBySequenceContact(sequenceContactId);
    let cancelled = 0;
    for (const row of rows) {
      if (row.organizationId !== organizationId) continue;
      if (CANCELLABLE_STATUSES.includes(row.status)) {
        await this.scheduledEmails.update(row.id, {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
        });
        cancelled += 1;
      }
    }
    return cancelled;
  }

  /** §28 — same cancellation, scoped to every contact of one company within ONE sequence (never a global exclusion by itself). */
  async cancelFutureJobsForCompany(
    organizationId: string,
    sequenceId: string,
    companyId: string,
    reason: string,
  ): Promise<number> {
    const rows = await this.scheduledEmails.findAll(organizationId, { sequenceId, companyId });
    let cancelled = 0;
    for (const row of rows) {
      if (CANCELLABLE_STATUSES.includes(row.status)) {
        await this.scheduledEmails.update(row.id, {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
        });
        cancelled += 1;
      }
    }
    return cancelled;
  }

  /** Admin monitor §4.5 "Cancelar futuros envíos" — every not-yet-sent job across the WHOLE sequence, without archiving it. */
  async cancelFutureJobsForSequence(
    organizationId: string,
    sequenceId: string,
    reason: string,
  ): Promise<number> {
    const rows = await this.scheduledEmails.findAll(organizationId, { sequenceId });
    let cancelled = 0;
    for (const row of rows) {
      if (CANCELLABLE_STATUSES.includes(row.status)) {
        await this.scheduledEmails.update(row.id, {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
        });
        cancelled += 1;
      }
    }
    return cancelled;
  }

  async listForSequence(organizationId: string, sequenceId: string): Promise<ScheduledEmail[]> {
    return this.scheduledEmails.findAll(organizationId, { sequenceId });
  }

  async getById(organizationId: string, id: string): Promise<ScheduledEmail> {
    return this.getOwnedScheduledEmail(organizationId, id);
  }

  private delayToMs(value: number, unit: DelayUnit): number {
    const perUnit = unit === 'MINUTES' ? 60_000 : unit === 'HOURS' ? 3_600_000 : 86_400_000;
    return value * perUnit;
  }

  private async getOwnedScheduledEmail(organizationId: string, id: string): Promise<ScheduledEmail> {
    const row = await this.scheduledEmails.findById(id);
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException('Scheduled email not found.');
    }
    return row;
  }
}
