import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ConversationMessageRepository } from '../../domain/conversation/conversation-message.repository';
import { ConversationNoteRepository } from '../../domain/conversation/conversation-note.repository';
import { ConversationReadStateRepository } from '../../domain/conversation/conversation-read-state.repository';
import { Conversation } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SimulationConversationBatchRepository } from '../../domain/simulation-conversation/simulation-conversation-batch.repository';
import {
  AUDIT_LOG_REPOSITORY,
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  CONVERSATION_MESSAGE_REPOSITORY,
  CONVERSATION_NOTE_REPOSITORY,
  CONVERSATION_READ_STATE_REPOSITORY,
  CONVERSATION_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SIMULATION_CONVERSATION_BATCH_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { SimulationConversationsService } from './simulation-conversations.service';
import { DeleteSimulationConversationsPreview, DeleteSimulationConversationsResult } from './simulation-conversations.types';

/**
 * "Eliminar conversaciones de prueba" (§14) — deletes ONLY the rows this
 * exact batch created: 4 Conversations (and their read-states/tag-
 * assignments/notes/messages), their 4 SequenceContacts, their 4 Contacts,
 * the 1 synthetic Company, the 1 QA Sequence (and its SequenceStep), then
 * the batch row itself. Deliberately preserves: audit_logs, the real
 * Mailbox that was only ever referenced (never modified), every real
 * client/domain/user/organization/role/permission, and every real
 * Conversation (this use case never touches a row without
 * simulationBatchId === batch.id). The QA ManagedClient survives on
 * purpose — see GenerateSimulationConversationsUseCase's own comment.
 */
@Injectable()
export class DeleteSimulationConversationsUseCase {
  constructor(
    @Inject(SIMULATION_CONVERSATION_BATCH_REPOSITORY) private readonly batches: SimulationConversationBatchRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(CONVERSATION_MESSAGE_REPOSITORY) private readonly messages: ConversationMessageRepository,
    @Inject(CONVERSATION_NOTE_REPOSITORY) private readonly notes: ConversationNoteRepository,
    @Inject(CONVERSATION_READ_STATE_REPOSITORY) private readonly readStates: ConversationReadStateRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly sequenceSteps: SequenceStepRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly simulationConversationsService: SimulationConversationsService,
  ) {}

  async preview(organizationId: string, batchId: string): Promise<DeleteSimulationConversationsPreview> {
    const batch = await this.requireBatch(organizationId, batchId);
    const rows = await this.conversations.findAll(organizationId, { simulationBatchId: batch.id });
    const summary = await this.simulationConversationsService.toBatchSummary(batch);
    const uniqueCompanyIds = new Set(rows.map((r) => r.companyId).filter((id): id is string => Boolean(id)));
    const uniqueSequenceIds = new Set(rows.map((r) => r.sequenceId).filter((id): id is string => Boolean(id)));
    return {
      batch: summary,
      conversationCount: rows.length,
      messageCount: rows.length * 2,
      contactCount: rows.filter((r) => r.contactId).length,
      companyCount: uniqueCompanyIds.size,
      sequenceCount: uniqueSequenceIds.size,
    };
  }

  async execute(organizationId: string, actorId: string, batchId: string): Promise<DeleteSimulationConversationsResult> {
    const batch = await this.requireBatch(organizationId, batchId);
    const rows = await this.conversations.findAll(organizationId, { simulationBatchId: batch.id });

    const sequenceContactIds = new Set<string>();
    const contactIds = new Set<string>();
    const companyIds = new Set<string>();
    const sequenceIds = new Set<string>();
    const stepIds = new Set<string>();

    for (const row of rows) {
      await this.deleteConversationChildren(row);
      if (row.sequenceContactId) sequenceContactIds.add(row.sequenceContactId);
      if (row.contactId) contactIds.add(row.contactId);
      if (row.companyId) companyIds.add(row.companyId);
      if (row.sequenceId) sequenceIds.add(row.sequenceId);
      if (row.sequenceStepId) stepIds.add(row.sequenceStepId);
      await this.conversations.delete(row.id);
    }

    for (const id of sequenceContactIds) await this.sequenceContacts.delete(id);
    for (const id of contactIds) await this.contacts.delete(id);
    for (const id of stepIds) await this.sequenceSteps.remove(id);
    for (const id of sequenceIds) await this.sequences.delete(id);
    for (const id of companyIds) await this.companies.delete(id);

    await this.batches.delete(batch.id);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'simulation_conversations.delete',
      entityType: 'SimulationConversationBatch',
      entityId: batch.id,
      metadata: {
        mailboxId: batch.mailboxId,
        conversationsDeleted: rows.length,
        contactsDeleted: contactIds.size,
        companiesDeleted: companyIds.size,
        sequencesDeleted: sequenceIds.size,
      },
    });

    return {
      batchId: batch.id,
      conversationsDeleted: rows.length,
      messagesDeleted: rows.length * 2,
      contactsDeleted: contactIds.size,
      companiesDeleted: companyIds.size,
      sequencesDeleted: sequenceIds.size,
    };
  }

  /** Child-before-parent order matches the exact FK dependency chain: read-states/tags/notes/messages all reference the Conversation row, never the other way around. */
  private async deleteConversationChildren(conversation: Conversation): Promise<void> {
    await this.readStates.deleteByConversation(conversation.id);
    const tagIds = await this.conversations.listTagIds(conversation.id);
    for (const tagId of tagIds) await this.conversations.removeTag(conversation.id, tagId);
    await this.notes.deleteByConversation(conversation.id);
    await this.messages.deleteByConversation(conversation.id);
  }

  private async requireBatch(organizationId: string, batchId: string) {
    const batch = await this.batches.findById(batchId);
    if (!batch || batch.organizationId !== organizationId) {
      throw new NotFoundException('Lote de conversaciones de prueba no encontrado.');
    }
    return batch;
  }
}
