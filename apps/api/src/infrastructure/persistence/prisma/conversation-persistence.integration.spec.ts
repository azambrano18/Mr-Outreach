import { PrismaConversationRepository } from './prisma-conversation.repository';
import { PrismaConversationMessageRepository } from './prisma-conversation-message.repository';
import { PrismaConversationTagRepository } from './prisma-conversation-tag.repository';
import { PrismaConversationNoteRepository } from './prisma-conversation-note.repository';
import { PrismaConversationReadStateRepository } from './prisma-conversation-read-state.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedFullChain } from './test-fixtures';

/**
 * Fase "Conversaciones persistentes" — real Postgres validation for the 6
 * new tables. See prisma-user.repository.contract.spec.ts for why this is
 * skipped unless TEST_DATABASE_URL is configured.
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('Conversation persistence (Postgres real, test)', () => {
  let prisma: PrismaService;
  let conversations: PrismaConversationRepository;
  let messages: PrismaConversationMessageRepository;
  let tags: PrismaConversationTagRepository;
  let notes: PrismaConversationNoteRepository;
  let readStates: PrismaConversationReadStateRepository;

  beforeAll(async () => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
    await seedFullChain(prisma);
  });

  afterAll(async () => {
    await prisma.conversationReadState.deleteMany();
    await prisma.conversationTagAssignment.deleteMany();
    await prisma.conversationTag.deleteMany();
    await prisma.conversationNote.deleteMany();
    await prisma.conversationMessage.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.conversationReadState.deleteMany();
    await prisma.conversationTagAssignment.deleteMany();
    await prisma.conversationTag.deleteMany();
    await prisma.conversationNote.deleteMany();
    await prisma.conversationMessage.deleteMany();
    await prisma.conversation.deleteMany();
    conversations = new PrismaConversationRepository(prisma);
    messages = new PrismaConversationMessageRepository(prisma);
    tags = new PrismaConversationTagRepository(prisma);
    notes = new PrismaConversationNoteRepository(prisma);
    readStates = new PrismaConversationReadStateRepository(prisma);
  });

  async function createBaseConversation(overrides: Partial<Parameters<typeof conversations.create>[0]> = {}) {
    return conversations.create({
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      domainId: null,
      mailboxId: 'fx_mailbox_1',
      emailThreadId: `thread_${Math.random().toString(36).slice(2)}`,
      contactEmail: 'prospecto@empresa.cl',
      contactName: 'Prospecto Uno',
      origin: 'EXTERNAL_INBOUND',
      subject: 'Consulta sobre el servicio',
      isUnread: true,
      lastMessageAt: new Date(),
      ...overrides,
    });
  }

  it('persists a conversation and survives a simulated restart (fresh PrismaService instance reads it back)', async () => {
    const created = await createBaseConversation();

    const freshPrisma = new PrismaService();
    const freshRepo = new PrismaConversationRepository(freshPrisma);
    const reloaded = await freshRepo.findById(created.id);
    await freshPrisma.$disconnect();

    expect(reloaded).not.toBeNull();
    expect(reloaded!.id).toBe(created.id);
    expect(reloaded!.subject).toBe('Consulta sobre el servicio');
    expect(reloaded!.origin).toBe('EXTERNAL_INBOUND');
  });

  it('persists messages (inbound and outbound) and survives a simulated restart', async () => {
    const conversation = await createBaseConversation();
    const outbound = await messages.create({
      organizationId: 'fx_org_1',
      conversationId: conversation.id,
      mailboxId: 'fx_mailbox_1',
      emailMessageId: 'eng_msg_out_1',
      direction: 'OUTBOUND',
      messageIdHeader: '<out1@mroutreach.local>',
      senderEmail: 'ventas@empresa.cl',
      recipients: ['prospecto@empresa.cl'],
      subject: 'Hola',
      htmlBody: '<p>Hola</p>',
      plainTextBody: 'Hola',
      messageType: 'OUTREACH_EMAIL',
      sentAt: new Date(),
    });
    const inbound = await messages.create({
      organizationId: 'fx_org_1',
      conversationId: conversation.id,
      mailboxId: 'fx_mailbox_1',
      emailMessageId: 'eng_msg_in_1',
      direction: 'INBOUND',
      messageIdHeader: '<in1@prospecto.cl>',
      inReplyTo: '<out1@mroutreach.local>',
      senderEmail: 'prospecto@empresa.cl',
      recipients: ['ventas@empresa.cl'],
      subject: 'Re: Hola',
      htmlBody: '<p>Interesado</p>',
      plainTextBody: 'Interesado',
      messageType: 'HUMAN_REPLY',
      receivedAt: new Date(),
    });

    const freshPrisma = new PrismaService();
    const freshRepo = new PrismaConversationMessageRepository(freshPrisma);
    const reloaded = await freshRepo.findByConversation(conversation.id);
    await freshPrisma.$disconnect();

    expect(reloaded).toHaveLength(2);
    expect(reloaded.find((m) => m.id === outbound.id)?.direction).toBe('OUTBOUND');
    expect(reloaded.find((m) => m.id === inbound.id)?.direction).toBe('INBOUND');
    expect(reloaded.find((m) => m.id === inbound.id)?.inReplyTo).toBe('<out1@mroutreach.local>');
  });

  it('rejects a duplicate messageIdHeader within the same organization', async () => {
    const conversation = await createBaseConversation();
    await messages.create({
      organizationId: 'fx_org_1',
      conversationId: conversation.id,
      mailboxId: 'fx_mailbox_1',
      emailMessageId: 'dup_a',
      direction: 'INBOUND',
      messageIdHeader: '<duplicate@example.com>',
      senderEmail: 'a@example.com',
      recipients: ['b@example.com'],
      subject: 'x',
      htmlBody: 'x',
      plainTextBody: 'x',
      messageType: 'HUMAN_REPLY',
    });

    await expect(
      messages.create({
        organizationId: 'fx_org_1',
        conversationId: conversation.id,
        mailboxId: 'fx_mailbox_1',
        emailMessageId: 'dup_b',
        direction: 'INBOUND',
        messageIdHeader: '<duplicate@example.com>',
        senderEmail: 'a@example.com',
        recipients: ['b@example.com'],
        subject: 'x',
        htmlBody: 'x',
        plainTextBody: 'x',
        messageType: 'HUMAN_REPLY',
      }),
    ).rejects.toThrow();
  });

  it('allows the same messageIdHeader across two different organizations (composite unique, not global)', async () => {
    const convOrg1 = await createBaseConversation();
    const convOrg2 = await conversations.create({
      organizationId: 'fx_org_2',
      clientId: 'fx_client_org2',
      domainId: null,
      mailboxId: 'fx_mailbox_org2',
      emailThreadId: `thread_org2_${Math.random().toString(36).slice(2)}`,
      contactEmail: 'otro@empresa.cl',
      contactName: null,
      origin: 'EXTERNAL_INBOUND',
      subject: 'Otra organización',
      isUnread: true,
      lastMessageAt: new Date(),
    });

    await messages.create({
      organizationId: 'fx_org_1',
      conversationId: convOrg1.id,
      mailboxId: 'fx_mailbox_1',
      emailMessageId: 'shared_a',
      direction: 'INBOUND',
      messageIdHeader: '<shared-across-orgs@example.com>',
      senderEmail: 'a@example.com',
      recipients: ['b@example.com'],
      subject: 'x',
      htmlBody: 'x',
      plainTextBody: 'x',
      messageType: 'HUMAN_REPLY',
    });

    await expect(
      messages.create({
        organizationId: 'fx_org_2',
        conversationId: convOrg2.id,
        mailboxId: 'fx_mailbox_org2',
        emailMessageId: 'shared_b',
        direction: 'INBOUND',
        messageIdHeader: '<shared-across-orgs@example.com>',
        senderEmail: 'a@example.com',
        recipients: ['b@example.com'],
        subject: 'x',
        htmlBody: 'x',
        plainTextBody: 'x',
        messageType: 'HUMAN_REPLY',
      }),
    ).resolves.toBeDefined();
  });

  it('never returns another organization\'s conversations from findAll — multi-tenant isolation', async () => {
    await createBaseConversation();
    await conversations.create({
      organizationId: 'fx_org_2',
      clientId: 'fx_client_org2',
      domainId: null,
      mailboxId: 'fx_mailbox_org2',
      emailThreadId: `thread_org2_iso_${Math.random().toString(36).slice(2)}`,
      contactEmail: 'otro@empresa.cl',
      contactName: null,
      origin: 'EXTERNAL_INBOUND',
      subject: 'Aislada',
      isUnread: true,
      lastMessageAt: new Date(),
    });

    const org1Results = await conversations.findAll('fx_org_1');
    const org2Results = await conversations.findAll('fx_org_2');

    expect(org1Results.every((c) => c.organizationId === 'fx_org_1')).toBe(true);
    expect(org2Results.every((c) => c.organizationId === 'fx_org_2')).toBe(true);
  });

  it('creates and applies a tag, guarding against a cross-organization tag/conversation mismatch', async () => {
    const conversation = await createBaseConversation();
    const tag = await tags.create({ organizationId: 'fx_org_1', name: 'Interesado', color: '#00ff00', createdBy: 'fx_user_1' });

    await conversations.addTag(conversation.id, tag.id, 'fx_user_1');
    expect(await conversations.listTagIds(conversation.id)).toEqual([tag.id]);

    // A tag from a DIFFERENT organization must never attach to this conversation.
    const otherOrgTag = await tags.create({ organizationId: 'fx_org_2', name: 'OtraOrg', color: '#ff0000', createdBy: 'fx_user_org2' });
    await conversations.addTag(conversation.id, otherOrgTag.id, 'fx_user_1');
    expect(await conversations.listTagIds(conversation.id)).toEqual([tag.id]);

    await conversations.removeTag(conversation.id, tag.id);
    expect(await conversations.listTagIds(conversation.id)).toEqual([]);
  });

  it('creates an internal note, never sent to the contact or the motor (persistence-only assertion)', async () => {
    const conversation = await createBaseConversation();
    const note = await notes.create({
      organizationId: 'fx_org_1',
      conversationId: conversation.id,
      authorUserId: 'fx_user_1',
      content: 'Llamar mañana a las 10am.',
    });
    const found = await notes.findByConversation(conversation.id);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(note.id);
  });

  it('read state is per-user: user A reading a conversation never marks it read for user B', async () => {
    const conversation = await createBaseConversation();
    await readStates.markRead({
      organizationId: 'fx_org_1',
      conversationId: conversation.id,
      userId: 'fx_user_1',
      lastReadMessageId: null,
      lastReadAt: new Date(),
    });

    const userAState = await readStates.findForUser(conversation.id, 'fx_user_1');
    const userBState = await readStates.findForUser(conversation.id, 'fx_user_org2');

    expect(userAState).not.toBeNull();
    expect(userBState).toBeNull();
  });

  it('read state markRead is idempotent (upsert) — re-reading the same conversation updates, never duplicates', async () => {
    const conversation = await createBaseConversation();
    const first = await readStates.markRead({
      organizationId: 'fx_org_1',
      conversationId: conversation.id,
      userId: 'fx_user_1',
      lastReadMessageId: null,
      lastReadAt: new Date('2026-01-01T00:00:00Z'),
    });
    const second = await readStates.markRead({
      organizationId: 'fx_org_1',
      conversationId: conversation.id,
      userId: 'fx_user_1',
      lastReadMessageId: 'msg_1',
      lastReadAt: new Date('2026-01-02T00:00:00Z'),
    });

    expect(second.lastReadMessageId).toBe('msg_1');
    const all = await readStates.findAllForUser('fx_org_1', 'fx_user_1', [conversation.id]);
    expect(all).toHaveLength(1);
    expect(first.conversationId).toBe(second.conversationId);
  });
});
