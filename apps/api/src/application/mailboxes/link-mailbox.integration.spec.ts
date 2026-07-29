import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { assertTestDatabaseEnvironment } from '../../infrastructure/persistence/prisma/test-database-guard';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { PRISMA_SERVICE } from '../../infrastructure/persistence/tokens';
import { SimulatedMailboxMotorAdapter } from '../../infrastructure/mailbox-motor/simulated/simulated-mailbox-motor-adapter';
import { LinkMailboxInput, LinkMailboxUseCase } from './link-mailbox.use-case';

/**
 * Fase 2.1 — real-PostgreSQL evidence for `LinkMailboxUseCase`. Runs only
 * against mr-outreach-test (`npm run test:integration`), CRM_DRIVER=mock.
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(30_000);

describeIfDatabaseAvailable('LinkMailboxUseCase (PostgreSQL integration)', () => {
  let moduleRef: TestingModule;
  let useCase: LinkMailboxUseCase;
  let motor: SimulatedMailboxMotorAdapter;
  let prisma: PrismaService;
  const stamp = Date.now();
  let orgId: string;
  let executiveId: string;

  beforeAll(async () => {
    assertTestDatabaseEnvironment();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    useCase = moduleRef.get(LinkMailboxUseCase);
    motor = moduleRef.get(SimulatedMailboxMotorAdapter);
    prisma = moduleRef.get(PRISMA_SERVICE);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `__fase2_1_link_${stamp}_${randomUUID()}` } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Exec', lastName: 'Uno', email: `exec-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'ACTIVE' },
    });
    executiveId = user.id;
  });

  afterEach(async () => {
    await prisma.mailboxAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.domain.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientExecutiveAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedClient.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  async function issueTokenAndAssign(overrides: Partial<Parameters<SimulatedMailboxMotorAdapter['issueLinkToken']>[0]> = {}) {
    const domainSuffix = randomUUID().slice(0, 6);
    const token = motor.issueLinkToken({
      email: `ventas@link-${stamp}-${domainSuffix}.test`,
      displayName: 'Ventas',
      domainName: `link-${stamp}-${domainSuffix}.test`,
      clientName: 'Cliente Fase 2.1',
      crmClientId: 2001,
      ...overrides,
    });
    const managedClient = await prisma.managedClient.create({
      data: { organizationId: orgId, crmClientId: 2001, name: 'Cliente Fase 2.1', createdBy: 'admin_1', updatedBy: 'admin_1' },
    });
    await prisma.clientExecutiveAssignment.create({
      data: { organizationId: orgId, clientId: managedClient.id, userId: executiveId, role: 'PRIMARY', assignedBy: 'admin_1' },
    });
    return token;
  }

  function input(token: string, overrides: Partial<LinkMailboxInput> = {}): LinkMailboxInput {
    return {
      organizationId: orgId,
      token,
      primaryExecutiveId: executiveId,
      actorId: 'admin_1',
      idempotencyKey: `key_${randomUUID()}`,
      ...overrides,
    };
  }

  it('links a mailbox for real: commits ManagedClient + Domain + Mailbox + assignment + command together', async () => {
    const token = await issueTokenAndAssign();

    const { result } = await useCase.execute(input(token));

    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: result.mailboxId } });
    expect(mailbox.linkSource).toBe('SERVER_TOKEN');
    expect(mailbox.linkStatus).toBe('ACTIVE');
    expect(mailbox.serverMailboxId).toBe(result.serverMailboxId);
    expect(mailbox.imapHost).toBeNull();
    expect(mailbox.smtpHost).toBeNull();

    const assignment = await prisma.mailboxAssignment.findFirst({ where: { mailboxId: mailbox.id, userId: executiveId } });
    expect(assignment?.role).toBe('PRIMARY');

    const command = await prisma.integrationCommand.findUnique({ where: { commandId: result.commandId } });
    expect(command?.commandType).toBe('MAILBOX_LINK_REQUESTED');
    expect(command?.status).toBe('COMPLETED');
    expect(JSON.stringify(command?.payload)).not.toContain(token);
    expect(JSON.stringify(command?.resultSnapshot)).not.toContain(token);
  });

  it('§10 — links successfully for an executive with no prior client assignment, and derives MAILBOX_DERIVED client visibility for them (real Postgres)', async () => {
    const token = await issueTokenAndAssign();
    const otherUser = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Sin', lastName: 'Asignar', email: `unassigned-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'ACTIVE' },
    });

    const { result } = await useCase.execute(input(token, { primaryExecutiveId: otherUser.id }));

    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    expect(mailboxCount).toBe(1);
    const visibility = await prisma.clientExecutiveAssignment.findUnique({
      where: { clientId_userId: { clientId: result.clientId, userId: otherUser.id } },
    });
    expect(visibility?.visibilitySource).toBe('MAILBOX_DERIVED');
    expect(visibility?.role).toBe('SECONDARY');
  });

  it('rolls back everything for real for an inactive executive (409, real Postgres)', async () => {
    const token = await issueTokenAndAssign();
    const inactiveUser = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Inactivo', lastName: 'Uno', email: `inactive-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'INACTIVE' },
    });

    await expect(useCase.execute(input(token, { primaryExecutiveId: inactiveUser.id }))).rejects.toThrow(ConflictException);

    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    expect(mailboxCount).toBe(0);
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(commandCount).toBe(0);
  });

  it('enforces UNIQUE(serverMailboxId): a second organization cannot link the same server mailbox locally', async () => {
    const token = await issueTokenAndAssign();
    await useCase.execute(input(token));

    const org2 = await prisma.organization.create({ data: { name: `__fase2_1_link_org2_${stamp}_${randomUUID()}` } });
    try {
      const user2 = await prisma.user.create({
        data: { organizationId: org2.id, firstName: 'Exec', lastName: 'Dos', email: `exec2-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'ACTIVE' },
      });
      const managedClient2 = await prisma.managedClient.create({
        data: { organizationId: org2.id, crmClientId: 2001, name: 'Cliente Fase 2.1', createdBy: 'admin_1', updatedBy: 'admin_1' },
      });
      await prisma.clientExecutiveAssignment.create({
        data: { organizationId: org2.id, clientId: managedClient2.id, userId: user2.id, role: 'PRIMARY', assignedBy: 'admin_1' },
      });

      // Same token, redeemed by a different requestingOrganizationId at the motor level → 409 from the port itself.
      await expect(
        useCase.execute({
          organizationId: org2.id,
          token,
          primaryExecutiveId: user2.id,
          actorId: 'admin_1',
          idempotencyKey: `key_${randomUUID()}`,
        }),
      ).rejects.toThrow(ConflictException);
    } finally {
      await prisma.clientExecutiveAssignment.deleteMany({ where: { organizationId: org2.id } });
      await prisma.user.deleteMany({ where: { organizationId: org2.id } });
      await prisma.managedClient.deleteMany({ where: { organizationId: org2.id } });
      await prisma.organization.delete({ where: { id: org2.id } }).catch(() => undefined);
    }
  });

  it('returns the identical idempotent result on a retry with the same key, never creating a second mailbox', async () => {
    const token = await issueTokenAndAssign();
    const attempt = input(token);

    const first = await useCase.execute(attempt);
    const second = await useCase.execute(attempt);

    expect(second.result).toEqual(first.result);
    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    expect(mailboxCount).toBe(1);
  });

  it('produces a single business effect under real concurrency (same token, same key)', async () => {
    const token = await issueTokenAndAssign();
    const attempt = input(token);

    const [a, b] = await Promise.allSettled([useCase.execute(attempt), useCase.execute(attempt)]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    if (a.status === 'fulfilled' && b.status === 'fulfilled') {
      expect(a.value.result.mailboxId).toBe(b.value.result.mailboxId);
    }
    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    expect(mailboxCount).toBe(1);
  });

  it('survives a full restart: a brand-new application context still returns the identical idempotent result', async () => {
    const token = await issueTokenAndAssign();
    const attempt = input(token);
    const first = await useCase.execute(attempt);

    await moduleRef.close();
    const restarted = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const restartedUseCase = restarted.get(LinkMailboxUseCase);
      const second = await restartedUseCase.execute(attempt);
      expect(second.result).toEqual(first.result);

      const restartedPrisma: PrismaService = restarted.get(PRISMA_SERVICE);
      const mailbox = await restartedPrisma.mailbox.findUniqueOrThrow({ where: { id: first.result.mailboxId } });
      expect(mailbox.linkStatus).toBe('ACTIVE');
    } finally {
      await restarted.close();
      moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      useCase = moduleRef.get(LinkMailboxUseCase);
      motor = moduleRef.get(SimulatedMailboxMotorAdapter);
      prisma = moduleRef.get(PRISMA_SERVICE);
    }
  }, 30_000);
});
