import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { PRISMA_SERVICE } from '../../infrastructure/persistence/tokens';
import { assertTestDatabaseEnvironment } from '../../infrastructure/persistence/prisma/test-database-guard';
import { ConversationsService } from './conversations.service';

/**
 * Fase "Estado leído/no leído por usuario" — real-PostgreSQL evidence that
 * ConversationSummary.isUnread is genuinely per-user, backed by
 * ConversationReadState + the last-inbound-message aggregate query, never
 * the coarse Conversation.isUnread column. Runs only against
 * mr-outreach-test (`npm run test:integration`).
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(30_000);

describeIfDatabaseAvailable('Per-user conversation read state (PostgreSQL integration)', () => {
  let moduleRef: TestingModule;
  let service: ConversationsService;
  let prisma: PrismaService;
  const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;

  let orgId: string;
  let adminId: string;
  let executiveId: string;
  let mailboxId: string;
  let clientId: string;
  let domainId: string;

  beforeAll(async () => {
    assertTestDatabaseEnvironment();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    service = moduleRef.get(ConversationsService);
    prisma = moduleRef.get(PRISMA_SERVICE);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `__read_state_${stamp}_${randomUUID()}` } });
    orgId = org.id;
    const admin = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Admin', lastName: 'Uno', email: `admin-${randomUUID()}@example.com`, passwordHash: 'hash' },
    });
    adminId = admin.id;
    const executive = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Ejecutiva', lastName: 'Uno', email: `exec-${randomUUID()}@example.com`, passwordHash: 'hash' },
    });
    executiveId = executive.id;
    const client = await prisma.managedClient.create({
      data: { organizationId: orgId, source: 'SERVER', serverClientId: `srv_${randomUUID()}`, name: 'Cliente Read State', createdBy: 'seed', updatedBy: 'seed' },
    });
    clientId = client.id;
    const domain = await prisma.domain.create({
      data: { organizationId: orgId, clientId, domainName: `read-state-${randomUUID().slice(0, 8)}.test`, createdBy: 'seed', updatedBy: 'seed' },
    });
    domainId = domain.id;
    const mailbox = await prisma.mailbox.create({
      data: { organizationId: orgId, clientId, domainId, name: 'Ventas', email: `ventas-${randomUUID().slice(0, 8)}@cliente.test`, fromName: 'Ventas' },
    });
    mailboxId = mailbox.id;
    await prisma.mailboxAssignment.create({
      data: { organizationId: orgId, mailboxId, userId: executiveId, role: 'PRIMARY', assignedBy: adminId },
    });
  });

  afterEach(async () => {
    await prisma.conversationReadState.deleteMany({ where: { organizationId: orgId } });
    await prisma.conversationMessage.deleteMany({ where: { organizationId: orgId } });
    await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailboxAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.domain.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedClient.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  async function seedConversationWithInboundMessage(overrides: { assignedExecutiveId?: string | null } = {}) {
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        clientId,
        domainId,
        mailboxId,
        emailThreadId: `thread_${randomUUID()}`,
        contactEmail: 'prospecto@empresa.test',
        contactName: 'Prospecto',
        origin: 'ACTIVE_EXECUTION',
        assignedExecutiveId: overrides.assignedExecutiveId === undefined ? executiveId : overrides.assignedExecutiveId,
        subject: 'Hola',
        isUnread: true,
        lastMessageAt: new Date(),
      },
    });
    const inbound = await prisma.conversationMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        mailboxId,
        emailMessageId: `in_${randomUUID()}`,
        direction: 'INBOUND',
        senderEmail: 'prospecto@empresa.test',
        recipients: [],
        subject: 'Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
        receivedAt: new Date(),
        messageType: 'HUMAN_REPLY',
      },
    });
    return { conversation, inbound };
  }

  it('a new inbound message is unread for both the assigned executive and the admin, independently', async () => {
    const { conversation } = await seedConversationWithInboundMessage();

    const executiveList = await service.listForExecutive(orgId, executiveId, {}, executiveId);
    const adminList = await service.list(orgId, {}, [], adminId);

    expect(executiveList.find((c) => c.id === conversation.id)?.isUnread).toBe(true);
    expect(adminList.find((c) => c.id === conversation.id)?.isUnread).toBe(true);
  });

  it('admin opening the conversation marks it read only for the admin — the executive stays unread', async () => {
    const { conversation } = await seedConversationWithInboundMessage();

    await service.getById(orgId, conversation.id, { markAsRead: true, actorId: adminId });

    const adminList = await service.list(orgId, {}, [], adminId);
    const executiveList = await service.listForExecutive(orgId, executiveId, {}, executiveId);
    expect(adminList.find((c) => c.id === conversation.id)?.isUnread).toBe(false);
    expect(executiveList.find((c) => c.id === conversation.id)?.isUnread).toBe(true);
  });

  it('the executive opening the conversation afterwards marks it read for the executive too, independently', async () => {
    const { conversation } = await seedConversationWithInboundMessage();
    await service.getById(orgId, conversation.id, { markAsRead: true, actorId: adminId });

    await service.getByIdForExecutive(orgId, executiveId, conversation.id);

    const executiveList = await service.listForExecutive(orgId, executiveId, {}, executiveId);
    expect(executiveList.find((c) => c.id === conversation.id)?.isUnread).toBe(false);
  });

  it('a new inbound message after both have read it flips it unread again for both, independently', async () => {
    const { conversation } = await seedConversationWithInboundMessage();
    await service.getById(orgId, conversation.id, { markAsRead: true, actorId: adminId });
    await service.getByIdForExecutive(orgId, executiveId, conversation.id);

    await prisma.conversationMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        mailboxId,
        emailMessageId: `in_${randomUUID()}`,
        direction: 'INBOUND',
        senderEmail: 'prospecto@empresa.test',
        recipients: [],
        subject: 'Re: Hola',
        htmlBody: '<p>Otra vez</p>',
        plainTextBody: 'Otra vez',
        receivedAt: new Date(Date.now() + 1000),
        messageType: 'HUMAN_REPLY',
      },
    });

    const adminList = await service.list(orgId, {}, [], adminId);
    const executiveList = await service.listForExecutive(orgId, executiveId, {}, executiveId);
    expect(adminList.find((c) => c.id === conversation.id)?.isUnread).toBe(true);
    expect(executiveList.find((c) => c.id === conversation.id)?.isUnread).toBe(true);
  });

  it('a user from another organization cannot read or mark the conversation via getById (404)', async () => {
    const { conversation } = await seedConversationWithInboundMessage();
    const otherOrg = await prisma.organization.create({ data: { name: `__read_state_other_${stamp}_${randomUUID()}` } });

    await expect(service.getById(otherOrg.id, conversation.id, { markAsRead: true, actorId: adminId })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });

  it('an executive not assigned to the mailbox cannot access the conversation', async () => {
    const { conversation } = await seedConversationWithInboundMessage();
    const unassignedExecutive = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Sin', lastName: 'Asignar', email: `unassigned-${randomUUID()}@example.com`, passwordHash: 'hash' },
    });

    await expect(service.getByIdForExecutive(orgId, unassignedExecutive.id, conversation.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('listing conversations never marks anything as read', async () => {
    const { conversation } = await seedConversationWithInboundMessage();

    await service.listForExecutive(orgId, executiveId, {}, executiveId);
    await service.listForExecutive(orgId, executiveId, {}, executiveId);

    const readState = await prisma.conversationReadState.findUnique({
      where: { conversationId_userId: { conversationId: conversation.id, userId: executiveId } },
    });
    expect(readState).toBeNull();
    const stillUnread = await service.listForExecutive(orgId, executiveId, {}, executiveId);
    expect(stillUnread.find((c) => c.id === conversation.id)?.isUnread).toBe(true);
  });

  it('an outbound-only conversation (no inbound message yet) is never unread for anyone', async () => {
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        clientId,
        domainId,
        mailboxId,
        emailThreadId: `thread_${randomUUID()}`,
        contactEmail: 'prospecto@empresa.test',
        contactName: 'Prospecto',
        origin: 'ACTIVE_EXECUTION',
        assignedExecutiveId: executiveId,
        subject: 'Hola',
        isUnread: false,
        lastMessageAt: new Date(),
      },
    });
    await prisma.conversationMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        mailboxId,
        emailMessageId: `out_${randomUUID()}`,
        direction: 'OUTBOUND',
        senderEmail: 'ventas@cliente.test',
        recipients: ['prospecto@empresa.test'],
        subject: 'Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
        sentAt: new Date(),
        messageType: 'OUTREACH_EMAIL',
      },
    });

    const executiveList = await service.listForExecutive(orgId, executiveId, {}, executiveId);
    expect(executiveList.find((c) => c.id === conversation.id)?.isUnread).toBe(false);
  });

  it('an EXTERNAL_INBOUND (unmatched contact) conversation still shows as pending for an authorized admin', async () => {
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        clientId,
        domainId,
        mailboxId,
        emailThreadId: `ext_${randomUUID()}`,
        contactEmail: 'desconocido@otra.test',
        contactName: null,
        origin: 'EXTERNAL_INBOUND',
        assignedExecutiveId: null,
        subject: 'Hola',
        isUnread: true,
        lastMessageAt: new Date(),
      },
    });
    await prisma.conversationMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        mailboxId,
        emailMessageId: `in_${randomUUID()}`,
        direction: 'INBOUND',
        senderEmail: 'desconocido@otra.test',
        recipients: [],
        subject: 'Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
        receivedAt: new Date(),
        messageType: 'HUMAN_REPLY',
      },
    });

    const adminList = await service.list(orgId, {}, [], adminId);
    expect(adminList.find((c) => c.id === conversation.id)?.isUnread).toBe(true);
  });

  it('survives a real process restart — read state and unread computation are unaffected', async () => {
    const { conversation } = await seedConversationWithInboundMessage();
    await service.getByIdForExecutive(orgId, executiveId, conversation.id);

    await moduleRef.close();
    const restartedModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const restartedService = restartedModule.get(ConversationsService);
    const restartedPrisma = restartedModule.get<PrismaService>(PRISMA_SERVICE);

    const executiveList = await restartedService.listForExecutive(orgId, executiveId, {}, executiveId);
    const adminList = await restartedService.list(orgId, {}, [], adminId);
    expect(executiveList.find((c) => c.id === conversation.id)?.isUnread).toBe(false);
    expect(adminList.find((c) => c.id === conversation.id)?.isUnread).toBe(true);

    prisma = restartedPrisma;
    moduleRef = restartedModule;
  });

  it('unreadCount from countersForExecutive matches the number of conversations the unread=true filter returns', async () => {
    await seedConversationWithInboundMessage();
    await seedConversationWithInboundMessage();
    const { conversation: readOne } = await seedConversationWithInboundMessage();
    await service.getByIdForExecutive(orgId, executiveId, readOne.id);

    const counters = await service.countersForExecutive(orgId, executiveId, {}, executiveId);
    const unreadList = await service.listForExecutive(orgId, executiveId, { isUnread: true }, executiveId);

    expect(counters.unread).toBe(unreadList.length);
    expect(counters.unread).toBe(2);
  });

  it('opening the conversation clears the badge only for the user who opened it, not for a poller on another session for the same user', async () => {
    const { conversation } = await seedConversationWithInboundMessage();

    await service.getByIdForExecutive(orgId, executiveId, conversation.id);
    // A second, independent "list" call for the SAME user (simulating another browser tab polling) sees the same read state.
    const secondPoll = await service.listForExecutive(orgId, executiveId, {}, executiveId);
    expect(secondPoll.find((c) => c.id === conversation.id)?.isUnread).toBe(false);
  });
});
