import { NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ConversationMessageRepository } from '../../domain/conversation/conversation-message.repository';
import { ConversationNoteRepository } from '../../domain/conversation/conversation-note.repository';
import { ConversationReadStateRepository } from '../../domain/conversation/conversation-read-state.repository';
import { ConversationTagRepository } from '../../domain/conversation/conversation-tag.repository';
import { Conversation } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { UserRepository } from '../../domain/user/user.repository';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { SequencesService } from '../sequences/sequences.service';
import { ConversationsService } from './conversations.service';

describe('ConversationsService — §2 mailbox-assignment-based visibility (admin-operational-capabilities follow-up)', () => {
  let conversations: jest.Mocked<Pick<ConversationRepository, 'findById' | 'findAll' | 'update' | 'findByMailboxAndThread' | 'listTagIds'>>;
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findAll' | 'findById'>>;
  let clientAssignments: jest.Mocked<Pick<ClientExecutiveAssignmentRepository, 'findByUser'>>;
  let mailboxAssignments: jest.Mocked<Pick<MailboxAssignmentRepository, 'findByUser'>>;
  let clients: jest.Mocked<Pick<ManagedClientRepository, 'findById'>>;
  let domains: jest.Mocked<Pick<DomainRepository, 'findByClient' | 'findById'>>;
  let mailboxesService: jest.Mocked<Pick<MailboxesService, 'getInbox' | 'getThread' | 'setThreadReadState'>>;
  let service: ConversationsService;

  const orgId = 'org_1';
  const userId = 'admin_1';
  const otherOrgId = 'org_2';

  const assignedMailbox: Mailbox = {
    id: 'mailbox_1',
    organizationId: orgId,
    clientId: 'client_1',
    domainId: 'domain_1',
  } as Mailbox;
  const unassignedMailbox: Mailbox = {
    id: 'mailbox_2',
    organizationId: orgId,
    clientId: 'client_1',
    domainId: 'domain_1',
  } as Mailbox;

  function conversationOn(mailboxId: string, overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: `conv_${mailboxId}`,
      organizationId: orgId,
      clientId: 'client_1',
      domainId: 'domain_1',
      mailboxId,
      emailThreadId: 'thread_1',
      contactEmail: 'contacto@empresa.cl',
      contactName: null,
      companyNameSnapshot: null,
      contactId: null,
      companyId: null,
      origin: 'LEGACY_SEQUENCE',
      sequenceContactId: null,
      originatingScheduledEmailId: null,
      sequenceId: null,
      sequenceStepId: null,
      sequenceExecutionId: null,
      prospectImportRowId: null,
      assignedExecutiveId: null,
      subject: 'Asunto',
      managementStatus: 'NEW',
      classification: 'UNCLASSIFIED',
      responseOutcome: null,
      isUnread: true,
      lastMessageAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
      archivedAt: null,
      isSimulation: false,
      simulationBatchId: null,
      simulationScenario: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    conversations = {
      findById: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      findByMailboxAndThread: jest.fn().mockResolvedValue(null),
      listTagIds: jest.fn().mockResolvedValue([]),
    };
    mailboxes = {
      findAll: jest.fn().mockResolvedValue([assignedMailbox, unassignedMailbox]),
      findById: jest.fn(),
    };
    clientAssignments = { findByUser: jest.fn().mockResolvedValue([]) };
    mailboxAssignments = {
      findByUser: jest.fn().mockResolvedValue([{ id: 'a1', organizationId: orgId, mailboxId: 'mailbox_1', userId, role: 'PRIMARY', assignedBy: 'x', assignedAt: new Date() }]),
    };
    clients = { findById: jest.fn().mockResolvedValue({ id: 'client_1', organizationId: orgId, name: 'Cliente Demo' }) };
    domains = {
      findByClient: jest.fn().mockResolvedValue([{ id: 'domain_1', domainName: 'empresa.cl' }]),
      findById: jest.fn().mockResolvedValue({ id: 'domain_1', domainName: 'empresa.cl' }),
    };
    mailboxesService = {
      getInbox: jest.fn(),
      getThread: jest.fn(),
      setThreadReadState: jest.fn(),
    };

    service = new ConversationsService(
      conversations as unknown as ConversationRepository,
      { findLastInboundForConversations: jest.fn().mockResolvedValue(new Map()) } as unknown as ConversationMessageRepository,
      {} as unknown as ConversationTagRepository,
      {} as unknown as ConversationNoteRepository,
      { findAllForUser: jest.fn().mockResolvedValue([]) } as unknown as ConversationReadStateRepository,
      mailboxes as unknown as MailboxRepository,
      {} as unknown as SequenceRepository,
      clients as unknown as ManagedClientRepository,
      domains as unknown as DomainRepository,
      clientAssignments as unknown as ClientExecutiveAssignmentRepository,
      mailboxAssignments as unknown as MailboxAssignmentRepository,
      {} as unknown as UserRepository,
      { record: jest.fn() } as unknown as AuditLogRepository,
      {} as unknown as CompanyRepository,
      {} as unknown as ScheduledEmailRepository,
      {} as unknown as SequenceStepRepository,
      {} as unknown as SequenceContactRepository,
      mailboxesService as unknown as MailboxesService,
      {} as unknown as SequencesService,
    );
  });

  describe('listForExecutive', () => {
    it('a user with only a MailboxAssignment (no ClientExecutiveAssignment) sees conversations from that mailbox', async () => {
      conversations.findAll.mockResolvedValue([conversationOn('mailbox_1'), conversationOn('mailbox_2')]);
      const result = await service.listForExecutive(orgId, userId, {}, userId);
      expect(result).toHaveLength(1);
      expect(result[0].mailboxId).toBe('mailbox_1');
    });

    it('PRIMARY and SECONDARY MailboxAssignment roles both grant visibility', async () => {
      conversations.findAll.mockResolvedValue([conversationOn('mailbox_1')]);
      mailboxAssignments.findByUser.mockResolvedValue([
        { id: 'a1', organizationId: orgId, mailboxId: 'mailbox_1', userId, role: 'SECONDARY', assignedBy: 'x', assignedAt: new Date() },
      ]);
      const result = await service.listForExecutive(orgId, userId, {}, userId);
      expect(result).toHaveLength(1);
    });

    it('a user with no assignment of either kind sees nothing', async () => {
      mailboxAssignments.findByUser.mockResolvedValue([]);
      conversations.findAll.mockResolvedValue([conversationOn('mailbox_1'), conversationOn('mailbox_2')]);
      const result = await service.listForExecutive(orgId, userId, {}, userId);
      expect(result).toHaveLength(0);
    });

    it('unassigning (removing the MailboxAssignment) removes operational access without deleting the conversations themselves', async () => {
      conversations.findAll.mockResolvedValue([conversationOn('mailbox_1')]);
      const before = await service.listForExecutive(orgId, userId, {}, userId);
      expect(before).toHaveLength(1);

      mailboxAssignments.findByUser.mockResolvedValue([]); // simulates unassignment
      const after = await service.listForExecutive(orgId, userId, {}, userId);
      expect(after).toHaveLength(0);
      // The underlying rows were never touched — findAll (the repository read) still returns them.
      expect(conversations.findAll).toHaveBeenCalled();
    });

    /**
     * Regression for the "Conversaciones de prueba" bug: a user with ONLY a
     * MailboxAssignment (no ClientExecutiveAssignment) has an empty
     * assignedClientIds set. AccountsWorkspace (the account-tree UI) always
     * sends clientId+domainId+mailboxId together for a selected mailbox — a
     * removed early "filter.clientId not in assignedClientIds -> []" check
     * used to reject this exact, legitimate request before it ever reached
     * the row-level visibility filter below.
     */
    it('a user with only a MailboxAssignment sees the conversation when the request carries clientId+domainId+mailboxId together', async () => {
      conversations.findAll.mockResolvedValue([conversationOn('mailbox_1')]);
      const result = await service.listForExecutive(
        orgId,
        userId,
        { clientId: 'client_1', domainId: 'domain_1', mailboxId: 'mailbox_1' },
        userId,
      );
      expect(result).toHaveLength(1);
      expect(result[0].mailboxId).toBe('mailbox_1');
    });

    it('a sibling account under the same client, not individually assigned, stays invisible even with an explicit clientId+domainId+mailboxId filter', async () => {
      conversations.findAll.mockResolvedValue([conversationOn('mailbox_2')]);
      const result = await service.listForExecutive(
        orgId,
        userId,
        { clientId: 'client_1', domainId: 'domain_1', mailboxId: 'mailbox_2' },
        userId,
      );
      expect(result).toHaveLength(0);
    });

    it('a manually manipulated clientId for a client the user has no access to never leaks that client\'s conversations, even with a matching mailboxId', async () => {
      conversations.findAll.mockResolvedValue([
        conversationOn('mailbox_stranger', { clientId: 'client_stranger', domainId: 'domain_stranger' }),
      ]);
      const result = await service.listForExecutive(
        orgId,
        userId,
        { clientId: 'client_stranger', domainId: 'domain_stranger', mailboxId: 'mailbox_stranger' },
        userId,
      );
      expect(result).toHaveLength(0);
    });

    it('isSimulation=true forwards the filter to the repository and returns only what it reports back as simulated', async () => {
      conversations.findAll.mockImplementation(async (_orgId, filter) =>
        filter?.isSimulation === true ? [conversationOn('mailbox_1', { isSimulation: true })] : [],
      );
      const result = await service.listForExecutive(orgId, userId, { isSimulation: true }, userId);
      expect(conversations.findAll).toHaveBeenCalledWith(orgId, expect.objectContaining({ isSimulation: true }));
      expect(result).toHaveLength(1);
      expect(result[0].isSimulation).toBe(true);
    });

    it('isSimulation=false forwards the filter to the repository and returns only what it reports back as real', async () => {
      conversations.findAll.mockImplementation(async (_orgId, filter) =>
        filter?.isSimulation === false ? [conversationOn('mailbox_1', { isSimulation: false })] : [],
      );
      const result = await service.listForExecutive(orgId, userId, { isSimulation: false }, userId);
      expect(conversations.findAll).toHaveBeenCalledWith(orgId, expect.objectContaining({ isSimulation: false }));
      expect(result).toHaveLength(1);
      expect(result[0].isSimulation).toBe(false);
    });
  });

  describe('requireAccessibleConversation', () => {
    it('grants access via an active MailboxAssignment alone', async () => {
      conversations.findById.mockResolvedValue(conversationOn('mailbox_1'));
      await expect(service.requireAccessibleConversation(orgId, userId, 'conv_mailbox_1')).resolves.toBeDefined();
    });

    it('404s (never a different error) for a mailbox the user is not assigned to — the backend always revalidates, a manually-edited mailboxId query param can never bypass this', async () => {
      conversations.findById.mockResolvedValue(conversationOn('mailbox_2'));
      await expect(service.requireAccessibleConversation(orgId, userId, 'conv_mailbox_2')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s for a conversation belonging to another organization', async () => {
      conversations.findById.mockResolvedValue(conversationOn('mailbox_1', { organizationId: otherOrgId }));
      await expect(service.requireAccessibleConversation(orgId, userId, 'conv_mailbox_1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getConversationTreeForExecutive', () => {
    it('surfaces only the specifically mailbox-assigned account, never sibling mailboxes under the same client the user has no client-level assignment for', async () => {
      const tree = await service.getConversationTreeForExecutive(orgId, userId, userId);
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('client_1');
      const allMailboxIds = tree[0].domains.flatMap((d) => d.mailboxes.map((m) => m.id));
      expect(allMailboxIds).toEqual(['mailbox_1']);
    });

    it('an admin continues seeing the account administratively (via /mailboxes.findAll) regardless of this operational tree', async () => {
      await service.getConversationTreeForExecutive(orgId, userId, userId);
      expect(mailboxes.findAll).toHaveBeenCalledWith(orgId);
    });
  });
});
