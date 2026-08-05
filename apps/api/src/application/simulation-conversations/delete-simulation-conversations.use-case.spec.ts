import { NotFoundException } from '@nestjs/common';
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
import { DeleteSimulationConversationsUseCase } from './delete-simulation-conversations.use-case';
import { SimulationConversationsService } from './simulation-conversations.service';

describe('DeleteSimulationConversationsUseCase — "Eliminar conversaciones de prueba"', () => {
  let batches: jest.Mocked<Pick<SimulationConversationBatchRepository, 'findById' | 'delete'>>;
  let conversations: jest.Mocked<Pick<ConversationRepository, 'findAll' | 'delete' | 'listTagIds' | 'removeTag'>>;
  let messages: jest.Mocked<Pick<ConversationMessageRepository, 'deleteByConversation'>>;
  let notes: jest.Mocked<Pick<ConversationNoteRepository, 'deleteByConversation'>>;
  let readStates: jest.Mocked<Pick<ConversationReadStateRepository, 'deleteByConversation'>>;
  let sequenceContacts: jest.Mocked<Pick<SequenceContactRepository, 'delete'>>;
  let contacts: jest.Mocked<Pick<ContactRepository, 'delete'>>;
  let companies: jest.Mocked<Pick<CompanyRepository, 'delete'>>;
  let sequences: jest.Mocked<Pick<SequenceRepository, 'delete'>>;
  let sequenceSteps: jest.Mocked<Pick<SequenceStepRepository, 'remove'>>;
  let auditLogs: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let simulationConversationsService: jest.Mocked<Pick<SimulationConversationsService, 'toBatchSummary'>>;
  let useCase: DeleteSimulationConversationsUseCase;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';
  const actorId = 'admin_1';
  const batchId = 'batch_1';

  const batch = {
    id: batchId,
    organizationId: orgId,
    mailboxId: 'mailbox_1',
    createdByUserId: actorId,
    idempotencyKey: 'idem_1',
    createdAt: new Date(),
    metadata: null,
  };

  function buildRow(overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: `conv_${Math.random().toString(36).slice(2)}`,
      organizationId: orgId,
      simulationBatchId: batchId,
      sequenceContactId: 'sc_1',
      contactId: 'contact_1',
      companyId: 'company_1',
      sequenceId: 'sequence_1',
      sequenceStepId: 'step_1',
      ...overrides,
    } as Conversation;
  }

  beforeEach(() => {
    batches = { findById: jest.fn().mockResolvedValue(batch), delete: jest.fn().mockResolvedValue(undefined) };
    conversations = {
      findAll: jest.fn().mockResolvedValue([
        buildRow({ id: 'conv_1', sequenceContactId: 'sc_1', contactId: 'contact_1' }),
        buildRow({ id: 'conv_2', sequenceContactId: 'sc_2', contactId: 'contact_2' }),
        buildRow({ id: 'conv_3', sequenceContactId: 'sc_3', contactId: 'contact_3' }),
        buildRow({ id: 'conv_4', sequenceContactId: 'sc_4', contactId: 'contact_4' }),
      ]),
      delete: jest.fn().mockResolvedValue(undefined),
      listTagIds: jest.fn().mockResolvedValue([]),
      removeTag: jest.fn().mockResolvedValue(undefined),
    };
    messages = { deleteByConversation: jest.fn().mockResolvedValue(undefined) };
    notes = { deleteByConversation: jest.fn().mockResolvedValue(undefined) };
    readStates = { deleteByConversation: jest.fn().mockResolvedValue(undefined) };
    sequenceContacts = { delete: jest.fn().mockResolvedValue(undefined) };
    contacts = { delete: jest.fn().mockResolvedValue(undefined) };
    companies = { delete: jest.fn().mockResolvedValue(undefined) };
    sequences = { delete: jest.fn().mockResolvedValue(undefined) };
    sequenceSteps = { remove: jest.fn().mockResolvedValue(undefined) };
    auditLogs = { record: jest.fn().mockResolvedValue(undefined) };
    simulationConversationsService = {
      toBatchSummary: jest.fn().mockResolvedValue({ id: batchId, conversations: [] }),
    };

    useCase = new DeleteSimulationConversationsUseCase(
      batches as unknown as SimulationConversationBatchRepository,
      conversations as unknown as ConversationRepository,
      messages as unknown as ConversationMessageRepository,
      notes as unknown as ConversationNoteRepository,
      readStates as unknown as ConversationReadStateRepository,
      sequenceContacts as unknown as SequenceContactRepository,
      contacts as unknown as ContactRepository,
      companies as unknown as CompanyRepository,
      sequences as unknown as SequenceRepository,
      sequenceSteps as unknown as SequenceStepRepository,
      auditLogs as unknown as AuditLogRepository,
      simulationConversationsService as unknown as SimulationConversationsService,
    );
  });

  describe('preview', () => {
    it('reports the exact counts before confirming', async () => {
      const preview = await useCase.preview(orgId, batchId);
      expect(preview.conversationCount).toBe(4);
      expect(preview.messageCount).toBe(8);
      expect(preview.contactCount).toBe(4);
      expect(preview.companyCount).toBe(1);
      expect(preview.sequenceCount).toBe(1);
    });

    it('throws NotFoundException for a batch in a different organization', async () => {
      batches.findById.mockResolvedValue({ ...batch, organizationId: otherOrgId });
      await expect(useCase.preview(orgId, batchId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('execute', () => {
    it('deletes exactly the 4 conversations and their children (read-states/notes/messages)', async () => {
      await useCase.execute(orgId, actorId, batchId);
      expect(conversations.delete).toHaveBeenCalledTimes(4);
      expect(readStates.deleteByConversation).toHaveBeenCalledTimes(4);
      expect(notes.deleteByConversation).toHaveBeenCalledTimes(4);
      expect(messages.deleteByConversation).toHaveBeenCalledTimes(4);
    });

    it('deletes exactly the 4 SequenceContacts and 4 Contacts referenced by this batch', async () => {
      await useCase.execute(orgId, actorId, batchId);
      expect(sequenceContacts.delete).toHaveBeenCalledTimes(4);
      expect(contacts.delete).toHaveBeenCalledTimes(4);
    });

    it('deletes exactly the 1 shared Company and 1 shared Sequence (and its Step) — never once per conversation', async () => {
      await useCase.execute(orgId, actorId, batchId);
      expect(companies.delete).toHaveBeenCalledTimes(1);
      expect(companies.delete).toHaveBeenCalledWith('company_1');
      expect(sequences.delete).toHaveBeenCalledTimes(1);
      expect(sequences.delete).toHaveBeenCalledWith('sequence_1');
      expect(sequenceSteps.remove).toHaveBeenCalledTimes(1);
      expect(sequenceSteps.remove).toHaveBeenCalledWith('step_1');
    });

    it('deletes the batch ledger row itself', async () => {
      await useCase.execute(orgId, actorId, batchId);
      expect(batches.delete).toHaveBeenCalledWith(batchId);
    });

    it('removes any tag assignments before deleting the conversation (FK-safe order)', async () => {
      conversations.listTagIds.mockResolvedValueOnce(['tag_1']);
      await useCase.execute(orgId, actorId, batchId);
      expect(conversations.removeTag).toHaveBeenCalledWith('conv_1', 'tag_1');
    });

    it('records exactly one audit log entry — auditoría se conserva, nunca se borra', async () => {
      await useCase.execute(orgId, actorId, batchId);
      expect(auditLogs.record).toHaveBeenCalledTimes(1);
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'simulation_conversations.delete', entityType: 'SimulationConversationBatch', entityId: batchId }),
      );
    });

    it('throws NotFoundException (never deletes anything) for a batch belonging to a different organization', async () => {
      batches.findById.mockResolvedValue({ ...batch, organizationId: otherOrgId });
      await expect(useCase.execute(orgId, actorId, batchId)).rejects.toThrow(NotFoundException);
      expect(conversations.delete).not.toHaveBeenCalled();
      expect(batches.delete).not.toHaveBeenCalled();
    });

    it('is idempotent: a repeated delete on an already-deleted batch throws NotFoundException, never re-runs', async () => {
      batches.findById.mockResolvedValue(null);
      await expect(useCase.execute(orgId, actorId, batchId)).rejects.toThrow(NotFoundException);
      expect(conversations.delete).not.toHaveBeenCalled();
      expect(auditLogs.record).not.toHaveBeenCalled();
    });

    it('returns accurate deletion counts', async () => {
      const result = await useCase.execute(orgId, actorId, batchId);
      expect(result).toEqual({
        batchId,
        conversationsDeleted: 4,
        messagesDeleted: 8,
        contactsDeleted: 4,
        companiesDeleted: 1,
        sequencesDeleted: 1,
      });
    });
  });
});
