import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Contact } from '../../domain/contact/contact.entity';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ConversationNoteRepository } from '../../domain/conversation/conversation-note.repository';
import { Conversation, ResponseOutcome } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { IntegrationCommand } from '../../domain/integration/integration-command.entity';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SequenceContact } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import {
  AUDIT_LOG_REPOSITORY,
  CONTACT_REPOSITORY,
  CONVERSATION_NOTE_REPOSITORY,
  CONVERSATION_REPOSITORY,
  MAILBOX_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { IntegrationService } from '../integration/integration.service';
import { SchedulingService } from '../scheduling/scheduling.service';

type OutcomeAction = 'NOT_INTERESTED' | 'DO_NOT_CONTACT' | 'INTERESTED' | 'REFERRED';

const NON_ACTIVE_SEQUENCE_STATUSES = ['REMOVED', 'COMPLETED', 'COMPLETED_MANUALLY', 'UNSUBSCRIBED'];

export interface ReferProspectInput {
  newContactEmail: string;
  newContactFirstName?: string;
  newContactLastName?: string;
  sendFirstStepImmediately: boolean;
  reason?: string;
}

/**
 * The executive's business decision about a reply, reachable from the
 * conversation's own response-outcome bar — replaces the earlier
 * Pausar/Reanudar/Finalizar/No contactar 3-dot menu. "No interesado" and
 * "Interesado" both stop the WHOLE COMPANY's participation in this sequence
 * (reusing `SchedulingService.cancelFutureJobsForCompany`, the same
 * mechanism the admin's "retirar empresa" already uses) — they differ only
 * in the recorded outcome/reason, since interest means sales continues the
 * relationship manually outside the sequence. "No contactar" and "Deriva"
 * stay scoped to the one contact who actually replied, exactly like before.
 */
@Injectable()
export class ResponseOutcomeService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly conversationRepo: ConversationRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(CONVERSATION_NOTE_REPOSITORY) private readonly notes: ConversationNoteRepository,
    private readonly integration: IntegrationService,
    private readonly scheduling: SchedulingService,
  ) {}

  async notInterested(
    organizationId: string,
    conversationId: string,
    actorId: string,
    reason?: string,
  ): Promise<{ conversationId: string; command: IntegrationCommand; cancelledJobs: number; affectedContacts: number }> {
    return this.stopWholeCompany(
      organizationId,
      conversationId,
      actorId,
      'NOT_INTERESTED',
      reason ?? 'La empresa indicó que no está interesada.',
      reason,
    );
  }

  async interested(
    organizationId: string,
    conversationId: string,
    actorId: string,
    reason?: string,
  ): Promise<{ conversationId: string; command: IntegrationCommand; cancelledJobs: number; affectedContacts: number }> {
    return this.stopWholeCompany(
      organizationId,
      conversationId,
      actorId,
      'INTERESTED',
      reason ?? 'La empresa mostró interés — la gestión continúa fuera de la secuencia.',
      reason,
    );
  }

  /** §7.3 — scoped to this ONE email address; every other contact at the same company is untouched. */
  async doNotContact(
    organizationId: string,
    conversationId: string,
    actorId: string,
    reason: string,
  ): Promise<{ conversationId: string; contact: Contact; command: IntegrationCommand; cancelledJobs: number; affectedSequences: number }> {
    const { conversation, sequenceContact, contact } = await this.requireContext(organizationId, conversationId);
    if (contact.suppressed) {
      throw new ConflictException('Este contacto ya está marcado como "No contactar".');
    }

    const command = await this.submitAndApply(
      organizationId,
      conversation,
      sequenceContact,
      'DO_NOT_CONTACT',
      actorId,
      reason,
    );

    const allEnrollments = await this.sequenceContacts.findByContact(organizationId, contact.id);
    const activeEnrollments = allEnrollments.filter(
      (row) => !NON_ACTIVE_SEQUENCE_STATUSES.includes(row.status),
    );

    let cancelledJobs = 0;
    for (const enrollment of activeEnrollments) {
      cancelledJobs += await this.scheduling.cancelFutureJobsForContact(organizationId, enrollment.id, reason);
      await this.sequenceContacts.update(enrollment.id, {
        status: 'REMOVED',
        stoppedAt: new Date(),
        stopReason: `No contactar: ${reason}`,
      });
    }

    const updatedContact = await this.contacts.update(contact.id, {
      suppressed: true,
      suppressedAt: new Date(),
      suppressedReason: reason,
    });
    await this.conversationRepo.update(conversation.id, { responseOutcome: 'DO_NOT_CONTACT' });
    await this.recordNoteIfPresent(organizationId, conversation.id, actorId, 'DO_NOT_CONTACT', reason);

    return {
      conversationId: conversation.id,
      contact: updatedContact,
      command,
      cancelledJobs,
      affectedSequences: activeEnrollments.length,
    };
  }

  /** Deriva — swaps the contact who replied out for a new one within the same company/sequence. */
  async refer(
    organizationId: string,
    conversationId: string,
    actorId: string,
    input: ReferProspectInput,
  ): Promise<{
    conversationId: string;
    removedSequenceContact: SequenceContact;
    newContact: Contact;
    newSequenceContact: SequenceContact;
    command: IntegrationCommand;
    sentImmediately: boolean;
  }> {
    const { conversation, sequenceContact, contact } = await this.requireContext(organizationId, conversationId);
    const reason = input.reason ?? `Derivó a ${input.newContactEmail}`;

    const command = await this.submitAndApply(organizationId, conversation, sequenceContact, 'REFERRED', actorId, reason);

    await this.scheduling.cancelFutureJobsForContact(organizationId, sequenceContact.id, reason);
    const removedSequenceContact = await this.sequenceContacts.update(sequenceContact.id, {
      status: 'REMOVED',
      stoppedAt: new Date(),
      stopReason: reason,
    });

    let newContact = await this.contacts.findByEmail(organizationId, contact.clientId, input.newContactEmail);
    if (!newContact) {
      newContact = await this.contacts.create({
        organizationId,
        clientId: contact.clientId,
        companyId: contact.companyId,
        email: input.newContactEmail,
        firstName: input.newContactFirstName ?? null,
        lastName: input.newContactLastName ?? null,
      });
    }

    const existingEnrollment = await this.sequenceContacts.findByContactAndSequence(
      sequenceContact.sequenceId,
      newContact.id,
    );
    if (existingEnrollment && !NON_ACTIVE_SEQUENCE_STATUSES.includes(existingEnrollment.status)) {
      throw new ConflictException('El nuevo contacto ya participa activamente en esta secuencia.');
    }

    const sequence = await this.sequences.findById(sequenceContact.sequenceId);
    if (!sequence) {
      throw new NotFoundException('Sequence not found.');
    }
    const { enrolled } = await this.scheduling.enrollAcceptedContacts(organizationId, sequence, [
      { contactId: newContact.id, companyId: contact.companyId },
    ]);
    const newSequenceContact = enrolled[0];
    if (!newSequenceContact) {
      throw new ConflictException('No se pudo matricular al nuevo contacto — verifica que la secuencia tenga un step publicado.');
    }

    let sentImmediately = false;
    if (input.sendFirstStepImmediately) {
      await this.scheduling.sendFirstStepNow(organizationId, newSequenceContact, actorId);
      sentImmediately = true;
    }

    await this.conversationRepo.update(conversation.id, { responseOutcome: 'REFERRED' });
    await this.recordNoteIfPresent(organizationId, conversation.id, actorId, 'REFERRED', input.reason);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'response_outcome.refer',
      entityType: 'SequenceContact',
      entityId: sequenceContact.id,
      metadata: { conversationId: conversation.id, newContactEmail: input.newContactEmail, sentImmediately },
    });

    return {
      conversationId: conversation.id,
      removedSequenceContact,
      newContact,
      newSequenceContact,
      command,
      sentImmediately,
    };
  }

  private async stopWholeCompany(
    organizationId: string,
    conversationId: string,
    actorId: string,
    outcome: 'NOT_INTERESTED' | 'INTERESTED',
    reason: string,
    rawNote?: string,
  ): Promise<{ conversationId: string; command: IntegrationCommand; cancelledJobs: number; affectedContacts: number }> {
    const { conversation, sequenceContact } = await this.requireContext(organizationId, conversationId);
    if (!sequenceContact.companyId) {
      throw new ConflictException('Este contacto no tiene una empresa asociada.');
    }

    const command = await this.submitAndApply(organizationId, conversation, sequenceContact, outcome, actorId, reason);

    const cancelledJobs = await this.scheduling.cancelFutureJobsForCompany(
      organizationId,
      sequenceContact.sequenceId,
      sequenceContact.companyId,
      reason,
    );
    const companyContacts = await this.sequenceContacts.findBySequence(organizationId, sequenceContact.sequenceId, {
      companyId: sequenceContact.companyId,
    });
    const stillActive = companyContacts.filter((row) => !NON_ACTIVE_SEQUENCE_STATUSES.includes(row.status));
    await Promise.all(
      stillActive.map((row) =>
        this.sequenceContacts.update(row.id, {
          status: 'COMPLETED_MANUALLY',
          completedAt: new Date(),
          stoppedAt: new Date(),
          stopReason: reason,
        }),
      ),
    );

    await this.conversationRepo.update(conversation.id, { responseOutcome: outcome });
    await this.recordNoteIfPresent(organizationId, conversation.id, actorId, outcome, rawNote);

    return {
      conversationId: conversation.id,
      command,
      cancelledJobs,
      affectedContacts: stillActive.length,
    };
  }

  /** Nota interna (§2) — only persisted when the executive actually typed something; the DEFAULT audit reason text used for NOT_INTERESTED/INTERESTED must never masquerade as a note the user wrote. */
  private async recordNoteIfPresent(
    organizationId: string,
    conversationId: string,
    actorId: string,
    outcome: ResponseOutcome,
    rawNote?: string,
  ): Promise<void> {
    const trimmed = rawNote?.trim();
    if (!trimmed) return;
    await this.notes.create({
      organizationId,
      conversationId,
      authorUserId: actorId,
      content: trimmed,
      responseOutcome: outcome,
    });
  }

  private async submitAndApply(
    organizationId: string,
    conversation: Conversation,
    sequenceContact: SequenceContact,
    action: OutcomeAction,
    actorId: string,
    reason?: string,
  ): Promise<IntegrationCommand> {
    const mailbox: Mailbox | null = await this.mailboxes.findById(conversation.mailboxId);
    const payload = {
      commandType: 'PROSPECT_SEQUENCE_ACTION',
      organizationId,
      executiveId: sequenceContact.assignedExecutiveId,
      clientId: sequenceContact.clientId,
      mailboxId: mailbox?.id ?? conversation.mailboxId,
      conversationId: conversation.id,
      prospectId: sequenceContact.contactId,
      prospectEmail: conversation.contactEmail,
      companyId: sequenceContact.companyId,
      sequenceId: sequenceContact.sequenceId,
      action,
      reason: reason ?? null,
      requestedAt: new Date().toISOString(),
    };

    const { command, duplicate } = await this.integration.submit(
      {
        organizationId,
        commandType: 'PROSPECT_SEQUENCE_ACTION',
        aggregateType: 'SEQUENCE_CONTACT',
        aggregateId: sequenceContact.id,
        payload,
        requestedBy: actorId,
        idempotencyKey: `response-outcome:${sequenceContact.id}:${action}:${randomUUID()}`,
      },
      actorId,
    );

    if (!duplicate) {
      await this.integration.advance(organizationId, command.commandId, 'ALL', actorId);
    }

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: `response_outcome.${action.toLowerCase()}`,
      entityType: 'SequenceContact',
      entityId: sequenceContact.id,
      metadata: { conversationId: conversation.id, reason: reason ?? null },
    });

    return command;
  }

  /** Resolves conversation → its sequence-contact and the underlying `Contact` — 404s (never 403) when the conversation isn't reachable, and a clear 409 when it has no sequence participation to act on. */
  private async requireContext(
    organizationId: string,
    conversationId: string,
  ): Promise<{ conversation: Conversation; sequenceContact: SequenceContact; contact: Contact }> {
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation || conversation.organizationId !== organizationId) {
      throw new NotFoundException('Conversation not found.');
    }
    if (!conversation.sequenceContactId) {
      throw new ConflictException('Esta conversación no tiene un contacto de secuencia asociado.');
    }
    const sequenceContact = await this.sequenceContacts.findById(conversation.sequenceContactId);
    if (!sequenceContact || sequenceContact.organizationId !== organizationId) {
      throw new NotFoundException('Sequence contact not found.');
    }
    const contact = conversation.contactId ? await this.contacts.findById(conversation.contactId) : null;
    if (!contact) {
      throw new NotFoundException('Contact not found.');
    }
    return { conversation, sequenceContact, contact };
  }
}
