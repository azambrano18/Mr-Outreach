import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Contact } from '../../domain/contact/contact.entity';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { Conversation, ConversationClassification } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { ScheduledEmail } from '../../domain/scheduled-email/scheduled-email.entity';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContactStatus } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import {
  AUDIT_LOG_REPOSITORY,
  CONTACT_REPOSITORY,
  CONVERSATION_REPOSITORY,
  MAILBOX_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { IntegrationService } from '../integration/integration.service';
import { SchedulingService } from '../scheduling/scheduling.service';

/** §33 scenario menu, reusing ConversationClassification directly — it already IS this exact list plus a few extra nuances (see that type's own comment). */
export type ReplyScenario = ConversationClassification | 'UNIDENTIFIED';

/** §35-36 — which classifications stop the sequence outright vs. leave it running. */
const STOPPING_CLASSIFICATIONS: ConversationClassification[] = [
  'INTERESTED',
  'NOT_INTERESTED',
  'REQUESTS_INFORMATION',
  'FOLLOW_UP_LATER',
  'WRONG_CONTACT',
  'HARD_BOUNCE',
  'UNSUBSCRIBE',
];

const SEQUENCE_CONTACT_STATUS_BY_CLASSIFICATION: Partial<Record<ConversationClassification, SequenceContactStatus>> = {
  HARD_BOUNCE: 'BOUNCED',
  UNSUBSCRIBE: 'UNSUBSCRIBED',
};

const GLOBAL_SUPPRESS_CLASSIFICATIONS: ConversationClassification[] = ['HARD_BOUNCE', 'UNSUBSCRIBE'];

/**
 * §33-36 — "Simular respuesta". Unlike every other command in this phase,
 * a reply has no originating command in real life either: a real engine
 * detects it during IMAP polling and pushes the event unsolicited. So this
 * writes directly to the Inbox via `IntegrationService.recordDirectEvent`
 * (commandId: null) instead of going through submit/advance — the same
 * shape a real engine's inbound-reply push would have.
 */
@Injectable()
export class ReplySimulationService {
  constructor(
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly integration: IntegrationService,
    private readonly scheduling: SchedulingService,
  ) {}

  async simulateReply(
    organizationId: string,
    scheduledEmailId: string,
    scenario: ReplyScenario,
    actorId: string,
  ): Promise<{ event: IntegrationEvent; conversation: Conversation | null }> {
    const scheduledEmail = await this.getOwnedScheduledEmail(organizationId, scheduledEmailId);
    if (scheduledEmail.status !== 'SENT') {
      throw new ConflictException('Solo se puede simular una respuesta sobre un envío ya simulado como enviado.');
    }

    const sequenceContact = await this.sequenceContacts.findById(scheduledEmail.sequenceContactId);
    const sequence = await this.sequences.findById(scheduledEmail.sequenceId);
    const mailbox = await this.mailboxes.findById(scheduledEmail.mailboxId);

    if (scenario === 'UNIDENTIFIED') {
      const event = await this.integration.recordDirectEvent(
        organizationId,
        'INBOUND_REPLY_UNMATCHED',
        {
          mailboxId: scheduledEmail.mailboxId,
          rawSubject: `Re: ${scheduledEmail.subjectSnapshot ?? ''}`,
          receivedAt: new Date().toISOString(),
        },
        actorId,
      );
      return { event, conversation: null };
    }

    const contactEntity = await this.contacts.findById(scheduledEmail.contactId);

    const event = await this.integration.recordDirectEvent(
      organizationId,
      'INBOUND_REPLY_MATCHED',
      {
        clientId: sequence?.clientId ?? null,
        domainId: mailbox?.domainId ?? null,
        mailboxId: scheduledEmail.mailboxId,
        executiveId: sequenceContact?.assignedExecutiveId ?? null,
        sequenceId: scheduledEmail.sequenceId,
        sequenceVersion: scheduledEmail.sequenceVersion,
        sequenceStepId: scheduledEmail.sequenceStepId,
        stepVersion: scheduledEmail.stepVersion,
        sequenceContactId: scheduledEmail.sequenceContactId,
        contactId: scheduledEmail.contactId,
        companyId: scheduledEmail.companyId,
        originatingOutboundMessageId: scheduledEmail.id,
        originatingMessageIdHeader: scheduledEmail.messageIdHeader,
        classification: scenario,
        receivedAt: new Date().toISOString(),
      },
      actorId,
    );

    const conversation = await this.applyReplyEffects(
      organizationId,
      scheduledEmail,
      sequenceContact,
      contactEntity,
      mailbox?.domainId ?? null,
      sequence?.clientId ?? null,
      scenario,
      actorId,
    );

    return { event, conversation };
  }

  private async applyReplyEffects(
    organizationId: string,
    scheduledEmail: ScheduledEmail,
    sequenceContact: Awaited<ReturnType<SequenceContactRepository['findById']>>,
    contactEntity: Contact | null,
    domainId: string | null,
    clientId: string | null,
    classification: ConversationClassification,
    actorId: string,
  ): Promise<Conversation> {
    if (sequenceContact && STOPPING_CLASSIFICATIONS.includes(classification)) {
      const cancelled = await this.scheduling.cancelFutureJobsForContact(
        organizationId,
        sequenceContact.id,
        `Respuesta simulada: ${classification}`,
      );
      const nextStatus = SEQUENCE_CONTACT_STATUS_BY_CLASSIFICATION[classification] ?? 'REPLIED';
      await this.sequenceContacts.update(sequenceContact.id, {
        status: nextStatus,
        repliedAt: nextStatus === 'REPLIED' ? new Date() : sequenceContact.repliedAt,
        stoppedAt: new Date(),
        stopReason: `Respuesta simulada: ${classification}`,
      });
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'sequence_contact.auto_stop',
        entityType: 'SequenceContact',
        entityId: sequenceContact.id,
        metadata: { classification, cancelledJobs: cancelled },
      });

      if (GLOBAL_SUPPRESS_CLASSIFICATIONS.includes(classification) && contactEntity) {
        await this.contacts.update(contactEntity.id, {
          suppressed: true,
          suppressedAt: new Date(),
          suppressedReason: `Auto-suppressed: ${classification}`,
        });
      }
    }

    const threadId = `sim-thread-${scheduledEmail.sequenceContactId}`;
    const existing = await this.conversations.findByMailboxAndThread(scheduledEmail.mailboxId, threadId);
    const subject = `Re: ${scheduledEmail.subjectSnapshot ?? ''}`;

    if (existing) {
      const updated = await this.conversations.update(existing.id, {
        classification,
        lastMessageAt: new Date(),
        isUnread: true,
      });
      await this.auditLogs.record({
        organizationId,
        actorId,
        action: 'conversation.simulated_reply',
        entityType: 'Conversation',
        entityId: updated.id,
        metadata: { classification },
      });
      return updated;
    }

    const created = await this.conversations.create({
      organizationId,
      clientId,
      domainId,
      mailboxId: scheduledEmail.mailboxId,
      emailThreadId: threadId,
      contactEmail: contactEntity?.email ?? '',
      contactName:
        contactEntity?.fullName ??
        ([contactEntity?.firstName, contactEntity?.lastName].filter(Boolean).join(' ') || null),
      contactId: scheduledEmail.contactId,
      companyId: scheduledEmail.companyId,
      sequenceContactId: scheduledEmail.sequenceContactId,
      originatingScheduledEmailId: scheduledEmail.id,
      sequenceId: scheduledEmail.sequenceId,
      sequenceStepId: scheduledEmail.sequenceStepId,
      assignedExecutiveId: sequenceContact?.assignedExecutiveId ?? null,
      subject,
      classification,
      isUnread: true,
      lastMessageAt: new Date(),
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation.simulated_reply',
      entityType: 'Conversation',
      entityId: created.id,
      metadata: { classification },
    });

    return created;
  }

  private async getOwnedScheduledEmail(organizationId: string, id: string): Promise<ScheduledEmail> {
    const row = await this.scheduledEmails.findById(id);
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException('Scheduled email not found.');
    }
    return row;
  }
}
