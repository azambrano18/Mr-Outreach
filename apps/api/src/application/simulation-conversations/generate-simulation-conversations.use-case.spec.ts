import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ManagedClient } from '../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { Company } from '../../domain/company/company.entity';
import { CompanyRepository } from '../../domain/company/company.repository';
import { Contact } from '../../domain/contact/contact.entity';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ConversationMessageRepository } from '../../domain/conversation/conversation-message.repository';
import { Conversation } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { SequenceContact } from '../../domain/sequence-contact/sequence-contact.entity';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SimulationConversationBatchRepository } from '../../domain/simulation-conversation/simulation-conversation-batch.repository';
import { GenerateSimulationConversationsUseCase } from './generate-simulation-conversations.use-case';
import { SimulationConversationsService } from './simulation-conversations.service';

describe('GenerateSimulationConversationsUseCase — "Conversaciones de prueba" (QA)', () => {
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findById'>>;
  let mailboxAssignments: jest.Mocked<Pick<MailboxAssignmentRepository, 'findByMailbox'>>;
  let managedClients: jest.Mocked<Pick<ManagedClientRepository, 'findById'>>;
  let companies: jest.Mocked<Pick<CompanyRepository, 'create'>>;
  let contacts: jest.Mocked<Pick<ContactRepository, 'create'>>;
  let sequences: jest.Mocked<Pick<SequenceRepository, 'create' | 'update'>>;
  let sequenceSteps: jest.Mocked<Pick<SequenceStepRepository, 'create' | 'update'>>;
  let sequenceContacts: jest.Mocked<Pick<SequenceContactRepository, 'create' | 'update'>>;
  let conversations: jest.Mocked<Pick<ConversationRepository, 'create'>>;
  let messages: jest.Mocked<Pick<ConversationMessageRepository, 'create'>>;
  let batches: jest.Mocked<Pick<SimulationConversationBatchRepository, 'findByIdempotencyKey' | 'findActiveByOrganization' | 'create'>>;
  let auditLogs: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let simulationConversationsService: jest.Mocked<Pick<SimulationConversationsService, 'toBatchSummary'>>;
  let useCase: GenerateSimulationConversationsUseCase;

  const orgId = 'org_1';
  const actorId = 'admin_1';
  const mailboxId = 'mailbox_1';

  const mailbox: Mailbox = {
    id: mailboxId,
    organizationId: orgId,
    email: 'ventas@cliente-real.cl',
    fromName: 'Ventas',
    domainId: 'domain_1',
    clientId: 'client_1',
    status: 'ACTIVE',
    linkStatus: 'ACTIVE',
    timezone: 'America/Santiago',
  } as Mailbox;

  const realClient = { id: 'client_1', organizationId: orgId, name: 'Empresa Real', status: 'ACTIVE' } as ManagedClient;

  function baseInput(overrides: Partial<Parameters<GenerateSimulationConversationsUseCase['execute']>[0]> = {}) {
    return { organizationId: orgId, actorId, mailboxId, idempotencyKey: 'idem_1', ...overrides };
  }

  beforeEach(() => {
    let contactCounter = 0;
    let sequenceContactCounter = 0;
    let conversationCounter = 0;

    mailboxes = { findById: jest.fn().mockResolvedValue(mailbox) };
    mailboxAssignments = {
      findByMailbox: jest.fn().mockResolvedValue([{ id: 'assign_1', organizationId: orgId, mailboxId, userId: actorId, role: 'PRIMARY', assignedBy: actorId, assignedAt: new Date() }]),
    };
    managedClients = {
      findById: jest.fn().mockResolvedValue(realClient),
    };
    companies = {
      create: jest.fn().mockResolvedValue({ id: 'company_qa_1', organizationId: orgId, clientId: 'client_1' } as Company),
    };
    contacts = {
      create: jest.fn().mockImplementation(async (input) => {
        contactCounter += 1;
        return { id: `contact_qa_${contactCounter}`, ...input } as Contact;
      }),
    };
    sequences = {
      create: jest.fn().mockResolvedValue({ id: 'sequence_qa_1', organizationId: orgId, sequenceVersion: 0 } as Sequence),
      update: jest.fn().mockResolvedValue(undefined),
    };
    sequenceSteps = {
      create: jest.fn().mockResolvedValue({ id: 'step_qa_1', organizationId: orgId, sequenceId: 'sequence_qa_1', position: 1 }),
      update: jest.fn().mockResolvedValue({ id: 'step_qa_1', status: 'PUBLISHED' }),
    };
    sequenceContacts = {
      create: jest.fn().mockImplementation(async (input) => {
        sequenceContactCounter += 1;
        return { id: `sequence_contact_qa_${sequenceContactCounter}`, status: 'ACTIVE', ...input } as SequenceContact;
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    conversations = {
      create: jest.fn().mockImplementation(async (input) => {
        conversationCounter += 1;
        return { id: `conversation_qa_${conversationCounter}`, ...input } as Conversation;
      }),
    };
    messages = { create: jest.fn().mockResolvedValue(undefined) };
    batches = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      findActiveByOrganization: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'batch_1', organizationId: orgId, mailboxId, createdByUserId: actorId, idempotencyKey: 'idem_1', createdAt: new Date(), metadata: null }),
    };
    auditLogs = { record: jest.fn().mockResolvedValue(undefined) };
    simulationConversationsService = {
      toBatchSummary: jest.fn().mockResolvedValue({ id: 'batch_1', conversations: [] }),
    };

    useCase = new GenerateSimulationConversationsUseCase(
      mailboxes as unknown as MailboxRepository,
      mailboxAssignments as unknown as MailboxAssignmentRepository,
      managedClients as unknown as ManagedClientRepository,
      companies as unknown as CompanyRepository,
      contacts as unknown as ContactRepository,
      sequences as unknown as SequenceRepository,
      sequenceSteps as unknown as SequenceStepRepository,
      sequenceContacts as unknown as SequenceContactRepository,
      conversations as unknown as ConversationRepository,
      messages as unknown as ConversationMessageRepository,
      batches as unknown as SimulationConversationBatchRepository,
      auditLogs as unknown as AuditLogRepository,
      simulationConversationsService as unknown as SimulationConversationsService,
    );
  });

  it('generates exactly four conversations, each with a real sequenceContactId, marked as unread and isSimulation', async () => {
    await useCase.execute(baseInput());
    expect(conversations.create).toHaveBeenCalledTimes(4);
    for (const call of conversations.create.mock.calls) {
      const input = call[0];
      expect(input.sequenceContactId).toEqual(expect.stringContaining('sequence_contact_qa_'));
      expect(input.isUnread).toBe(true);
      expect(input.isSimulation).toBe(true);
      expect(input.simulationBatchId).toBe('batch_1');
    }
  });

  it('creates every Conversation under the SAME real client/domain/mailbox as the Mailbox itself — never a different ManagedClient', async () => {
    await useCase.execute(baseInput());
    expect(conversations.create).toHaveBeenCalledTimes(4);
    for (const call of conversations.create.mock.calls) {
      const input = call[0];
      expect(input.clientId).toBe(mailbox.clientId);
      expect(input.domainId).toBe(mailbox.domainId);
      expect(input.mailboxId).toBe(mailbox.id);
    }
  });

  it('creates the synthetic Company under the real Mailbox client, never a separate reserved client', async () => {
    await useCase.execute(baseInput());
    expect(companies.create).toHaveBeenCalledWith(expect.objectContaining({ clientId: mailbox.clientId }));
  });

  it('generates exactly four SequenceContact rows and four Contact rows, all under the real Mailbox client', async () => {
    await useCase.execute(baseInput());
    expect(sequenceContacts.create).toHaveBeenCalledTimes(4);
    expect(contacts.create).toHaveBeenCalledTimes(4);
    for (const call of contacts.create.mock.calls) {
      expect(call[0].clientId).toBe(mailbox.clientId);
    }
    for (const call of sequenceContacts.create.mock.calls) {
      expect(call[0].clientId).toBe(mailbox.clientId);
      expect(call[0].assignedMailboxId).toBe(mailbox.id);
    }
  });

  it('creates the Sequence and then updates it with the real Mailbox client and mailbox id', async () => {
    await useCase.execute(baseInput());
    expect(sequences.create).toHaveBeenCalledTimes(1);
    expect(sequences.update).toHaveBeenCalledWith(
      'sequence_qa_1',
      expect.objectContaining({ mailboxId: mailbox.id, clientId: mailbox.clientId }),
    );
  });

  it('generates exactly two ConversationMessage rows per conversation (outbound + inbound) — 8 total', async () => {
    await useCase.execute(baseInput());
    expect(messages.create).toHaveBeenCalledTimes(8);
    const directions = messages.create.mock.calls.map((call) => call[0].direction);
    expect(directions.filter((d) => d === 'OUTBOUND')).toHaveLength(4);
    expect(directions.filter((d) => d === 'INBOUND')).toHaveLength(4);
  });

  it('creates exactly one Company and one Sequence for all 4 conversations combined', async () => {
    await useCase.execute(baseInput());
    expect(companies.create).toHaveBeenCalledTimes(1);
    expect(sequences.create).toHaveBeenCalledTimes(1);
  });

  it('never calls a motor and never creates a ScheduledEmail — no such repository is even injected', () => {
    const injectedTokens = Object.getOwnPropertyNames(Object.getPrototypeOf(useCase));
    expect(injectedTokens.join(' ')).not.toMatch(/motor/i);
  });

  it('never creates or reuses a separate reserved QA ManagedClient — only reads the real Mailbox client by id', async () => {
    await useCase.execute(baseInput());
    expect(managedClients.findById).toHaveBeenCalledWith(mailbox.clientId);
    expect((managedClients as unknown as { create?: unknown }).create).toBeUndefined();
    expect((managedClients as unknown as { findAll?: unknown }).findAll).toBeUndefined();
  });

  it('rejects with a 400 when the Mailbox has no clientId', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, clientId: null });
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
    expect(companies.create).not.toHaveBeenCalled();
  });

  it('rejects with a 400 when the Mailbox has no domainId', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, domainId: null });
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
    expect(companies.create).not.toHaveBeenCalled();
  });

  it('rejects with a 400 when the ManagedClient for mailbox.clientId does not exist', async () => {
    managedClients.findById.mockResolvedValue(null);
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
    expect(companies.create).not.toHaveBeenCalled();
  });

  it('rejects with a 400 when the ManagedClient for mailbox.clientId belongs to another organization', async () => {
    managedClients.findById.mockResolvedValue({ ...realClient, organizationId: 'org_other' });
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
    expect(companies.create).not.toHaveBeenCalled();
  });

  it('rejects with a 400 when the ManagedClient for mailbox.clientId is not ACTIVE', async () => {
    managedClients.findById.mockResolvedValue({ ...realClient, status: 'INACTIVE' });
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
    expect(companies.create).not.toHaveBeenCalled();
  });

  it('rejects with a 400 and the exact required message when no mailboxId is eligible (mailbox not found)', async () => {
    mailboxes.findById.mockResolvedValue(null);
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
    await expect(useCase.execute(baseInput())).rejects.toThrow(
      'Debes vincular una cuenta de correo de prueba antes de generar las conversaciones.',
    );
  });

  it('rejects when the actor is not assigned to the mailbox', async () => {
    mailboxAssignments.findByMailbox.mockResolvedValue([]);
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
    expect(companies.create).not.toHaveBeenCalled();
  });

  it('rejects when the mailbox is REVOKED', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, linkStatus: 'REVOKED' });
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
  });

  it('rejects when the mailbox is not ACTIVE', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, status: 'INACTIVE' });
    await expect(useCase.execute(baseInput())).rejects.toThrow(BadRequestException);
  });

  it('rejects generating a second batch while one is already active for the organization', async () => {
    batches.findActiveByOrganization.mockResolvedValue({
      id: 'batch_existing',
      organizationId: orgId,
      mailboxId,
      createdByUserId: actorId,
      idempotencyKey: 'idem_other',
      createdAt: new Date(),
      metadata: null,
    });
    await expect(useCase.execute(baseInput())).rejects.toThrow(ConflictException);
    expect(batches.create).not.toHaveBeenCalled();
    expect(companies.create).not.toHaveBeenCalled();
  });

  it('a replay with the same idempotencyKey returns the existing batch without creating anything new', async () => {
    batches.findByIdempotencyKey.mockResolvedValue({
      id: 'batch_existing',
      organizationId: orgId,
      mailboxId,
      createdByUserId: actorId,
      idempotencyKey: 'idem_1',
      createdAt: new Date(),
      metadata: null,
    });
    const result = await useCase.execute(baseInput());
    expect(batches.create).not.toHaveBeenCalled();
    expect(companies.create).not.toHaveBeenCalled();
    expect(simulationConversationsService.toBatchSummary).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'batch_existing' }),
    );
    expect(result).toEqual({ id: 'batch_1', conversations: [] });
  });

  it('records exactly one audit log entry for the whole generation', async () => {
    await useCase.execute(baseInput());
    expect(auditLogs.record).toHaveBeenCalledTimes(1);
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'simulation_conversations.create', entityType: 'SimulationConversationBatch' }),
    );
  });

  it('uses the exact 4 reserved .invalid contact emails — never a real-looking domain', async () => {
    await useCase.execute(baseInput());
    const emails = contacts.create.mock.calls.map((call) => call[0].email);
    expect(emails.sort()).toEqual(
      [
        'deriva@conversation-test.invalid',
        'interesado@conversation-test.invalid',
        'no-contactar@conversation-test.invalid',
        'no-interesado@conversation-test.invalid',
      ].sort(),
    );
  });
});
