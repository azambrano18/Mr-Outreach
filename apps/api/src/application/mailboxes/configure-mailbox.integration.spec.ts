import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { assertTestDatabaseEnvironment } from '../../infrastructure/persistence/prisma/test-database-guard';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { PRISMA_SERVICE } from '../../infrastructure/persistence/tokens';
import { ConfigureMailboxInput, ConfigureMailboxUseCase } from './configure-mailbox.use-case';

/**
 * Fase 2, Caso A — the real-PostgreSQL evidence for atomicity, idempotency
 * and concurrency: mocks alone are never accepted as proof of rollback
 * behavior. Runs only against mr-outreach-test (via `npm run
 * test:integration`), CRM_DRIVER=mock throughout (never the real CRM).
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

// Every attempt now also calls advance('ALL') post-commit (the
// orphaned-command fix), adding real network round-trips to Neon on top
// of the existing dispatch call — the default 5s Jest timeout is too tight.
jest.setTimeout(30_000);

describeIfDatabaseAvailable('ConfigureMailboxUseCase (PostgreSQL integration)', () => {
  let moduleRef: TestingModule;
  let useCase: ConfigureMailboxUseCase;
  let prisma: PrismaService;
  const stamp = Date.now();
  let orgId: string;

  beforeAll(async () => {
    // DATABASE_URL/DIRECT_URL must already equal TEST_DATABASE_URL/TEST_DIRECT_URL,
    // and PERSISTENCE_DRIVER=postgres, CRM_DRIVER=mock must already be set —
    // all via the shell/`test:integration` script — *before* this file loads.
    // Mutating process.env this late (after ConfigModule may already be
    // primed elsewhere in the same --runInBand run) is not reliable.
    assertTestDatabaseEnvironment();

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    useCase = moduleRef.get(ConfigureMailboxUseCase);
    prisma = moduleRef.get(PRISMA_SERVICE);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `__fase2_case_a_${stamp}_${randomUUID()}` } });
    orgId = org.id;
  });

  afterEach(async () => {
    await prisma.mailboxAssignment.deleteMany({ where: { organizationId: orgId } });
    // §10 — grantForExecutives() may have created a MAILBOX_DERIVED
    // ClientExecutiveAssignment row; must go before managedClient (RESTRICT FK).
    await prisma.clientExecutiveAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.signatureVersion.deleteMany({ where: { signature: { organizationId: orgId } } });
    await prisma.signature.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.domain.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedClient.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  function input(overrides: Partial<ConfigureMailboxInput> = {}): ConfigureMailboxInput {
    return {
      organizationId: orgId,
      crmClientId: 2001, // MockCrmClientRepository's "Cliente Demo 1" — always ACTIVO
      domainName: `ventas-${stamp}.test`,
      email: `contacto@ventas-${stamp}.test`,
      fromName: 'Equipo de Ventas',
      imap: { host: 'imap.example.com', port: 993, encryption: 'SSL_TLS', username: 'contacto', password: 'imap-secret', verifyCertificate: true },
      smtp: { host: 'smtp.example.com', port: 587, encryption: 'STARTTLS', username: 'contacto', password: 'smtp-secret', verifyCertificate: true },
      actorId: 'admin_1',
      idempotencyKey: `key_${randomUUID()}`,
      ...overrides,
    };
  }

  it('commits ManagedClient + Domain + Mailbox + IntegrationCommand together in one real transaction, then drives it to COMPLETED post-commit (orphaned-command fix)', async () => {
    const { result, httpStatus } = await useCase.execute(input());
    expect(httpStatus).toBe(201);

    const mailbox = await prisma.mailbox.findUnique({ where: { id: result.mailboxId } });
    const domain = await prisma.domain.findUnique({ where: { id: result.domainId } });
    const managedClient = await prisma.managedClient.findUnique({ where: { id: result.clientId } });
    const command = await prisma.integrationCommand.findFirst({ where: { organizationId: orgId } });

    expect(mailbox).not.toBeNull();
    expect(domain).not.toBeNull();
    expect(managedClient).not.toBeNull();
    expect(command).not.toBeNull();
    // §"No debe existir una cuenta configurada sin referencia al comando
    // que originó su aprovisionamiento" — the exact defect this fix closes.
    expect(mailbox?.lastProvisionCommandId).toBe(command?.commandId);
    expect(command?.aggregateId).toBe(mailbox?.id);
    expect(command?.organizationId).toBe(orgId);
    expect(command?.commandType).toBe('MAILBOX_PROVISION_REQUESTED');
    // Driven all the way to COMPLETED by the post-commit dispatch+advance —
    // never stuck at ACCEPTED with the account left NOT_PROVISIONED.
    expect(command?.status).toBe('COMPLETED');
    expect(mailbox?.provisioningStatus).toBe('PROVISIONED');
    expect(mailbox?.connectionStatus).toBe('CONNECTED');
    expect(result.provisioningStatus).toBe('COMPLETED');
    expect(command?.payloadHash).toBeTruthy();
    expect(command?.resultSnapshot).toBeTruthy();
  });

  it('rolls back everything for real when the executive validator rejects a nonexistent executive (clean 404, no raw FK violation reaches the caller)', async () => {
    const attempt = input({ primaryExecutiveId: 'does-not-exist-in-users-table' });

    await expect(useCase.execute(attempt)).rejects.toThrow();

    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    const domainCount = await prisma.domain.count({ where: { organizationId: orgId } });
    const managedClientCount = await prisma.managedClient.count({ where: { organizationId: orgId } });
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    const auditCount = await prisma.auditLog.count({ where: { organizationId: orgId } });

    expect(mailboxCount).toBe(0);
    expect(domainCount).toBe(0);
    expect(managedClientCount).toBe(0);
    expect(commandCount).toBe(0);
    expect(auditCount).toBe(0);
  });

  it('§10 — succeeds for an executive with no prior client assignment, and derives MAILBOX_DERIVED client visibility for them (real Postgres)', async () => {
    const user = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Otro', lastName: 'Ejecutivo', email: `unassigned-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'ACTIVE' },
    });

    const attempt = input({ primaryExecutiveId: user.id });
    const { result } = await useCase.execute(attempt);

    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    expect(mailboxCount).toBe(1);
    const visibility = await prisma.clientExecutiveAssignment.findUnique({
      where: { clientId_userId: { clientId: result.clientId, userId: user.id } },
    });
    expect(visibility?.visibilitySource).toBe('MAILBOX_DERIVED');

    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });

  it('rolls back everything for real for an inactive executive (409, real Postgres)', async () => {
    const user = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Inactivo', lastName: 'Ejecutivo', email: `inactive-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'INACTIVE' },
    });

    const attempt = input({ primaryExecutiveId: user.id });
    await expect(useCase.execute(attempt)).rejects.toThrow();

    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(mailboxCount).toBe(0);
    expect(commandCount).toBe(0);

    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });

  it('returns the exact same persisted result on a retry with the same Idempotency-Key and payload, without creating anything new', async () => {
    const attempt = input();
    const first = await useCase.execute(attempt);
    const second = await useCase.execute(attempt);

    expect(second.result).toEqual(first.result);
    expect(second.httpStatus).toBe(first.httpStatus);

    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(mailboxCount).toBe(1);
    expect(commandCount).toBe(1);
  });

  it('rejects the same Idempotency-Key reused with a different payload as 409, without exposing the previous result', async () => {
    const key = `key_${randomUUID()}`;
    await useCase.execute(input({ idempotencyKey: key }));

    await expect(
      useCase.execute(input({ idempotencyKey: key, fromName: 'Un Nombre Completamente Distinto' })),
    ).rejects.toThrow(ConflictException);

    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(commandCount).toBe(1); // the second attempt never created a second row
  });

  it('produces a single business effect and a single command under real concurrency (same key, same payload)', async () => {
    const attempt = input();
    const [a, b] = await Promise.allSettled([useCase.execute(attempt), useCase.execute(attempt)]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');

    const mailboxCount = await prisma.mailbox.count({ where: { organizationId: orgId } });
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(mailboxCount).toBe(1);
    expect(commandCount).toBe(1);

    if (a.status === 'fulfilled' && b.status === 'fulfilled') {
      expect(a.value.result.mailboxId).toBe(b.value.result.mailboxId);
    }
  });

  it('never persists the plaintext IMAP/SMTP password anywhere (command payload, audit metadata)', async () => {
    await useCase.execute(input());

    const command = await prisma.integrationCommand.findFirst({ where: { organizationId: orgId } });
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: orgId } });

    expect(JSON.stringify(command?.payload)).not.toContain('imap-secret');
    expect(JSON.stringify(command?.payload)).not.toContain('smtp-secret');
    expect(JSON.stringify(audit?.metadata)).not.toContain('imap-secret');
    expect(JSON.stringify(audit?.metadata)).not.toContain('smtp-secret');
  });
});

/**
 * Fase 2 — restart-durability evidence, same pattern already established
 * by restart-durability.integration.spec.ts (Fase 1): write via one fully
 * independent NestJS application context, close it completely (including
 * its PrismaService's own $disconnect via onModuleDestroy — a real
 * connection teardown, not just "another repository in the same
 * process"), then build a brand-new one and retry. If the idempotent
 * result only lived in process memory, the second context could never
 * see it.
 */
describeIfDatabaseAvailable('ConfigureMailboxUseCase — restart durability (Fase 2)', () => {
  let firstModule: TestingModule;
  let orgId: string;
  const idempotencyKey = `restart-test-${Date.now()}`;

  function input(organizationId: string): ConfigureMailboxInput {
    return {
      organizationId,
      crmClientId: 2002,
      domainName: `restart-${Date.now()}.test`,
      email: `contacto@restart-${Date.now()}.test`,
      fromName: 'Equipo Restart',
      imap: { host: 'imap.example.com', port: 993, encryption: 'SSL_TLS', username: 'contacto', password: 'imap-secret', verifyCertificate: true },
      smtp: { host: 'smtp.example.com', port: 587, encryption: 'STARTTLS', username: 'contacto', password: 'smtp-secret', verifyCertificate: true },
      actorId: 'admin_1',
      idempotencyKey,
    };
  }

  afterAll(async () => {
    const cleanupModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const prisma: PrismaService = cleanupModule.get(PRISMA_SERVICE);
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.domain.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedClient.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await cleanupModule.close();
  });

  it('returns the exact same result after a full application restart, with no duplicate rows or commands', async () => {
    assertTestDatabaseEnvironment();

    firstModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const firstPrisma: PrismaService = firstModule.get(PRISMA_SERVICE);
    const org = await firstPrisma.organization.create({ data: { name: `__fase2_restart_${Date.now()}` } });
    orgId = org.id;

    const firstUseCase = firstModule.get(ConfigureMailboxUseCase);
    const attempt = input(orgId);
    const first = await firstUseCase.execute(attempt);

    // Simulate a full process shutdown: close the whole Nest application
    // context, which tears down PrismaService's real connection.
    await firstModule.close();

    // Brand-new application context — a genuinely new PrismaService, new
    // TCP connection, nothing shared with the one above beyond the DB itself.
    const secondModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const secondUseCase = secondModule.get(ConfigureMailboxUseCase);
      const second = await secondUseCase.execute(attempt);

      expect(second.result).toEqual(first.result);
      expect(second.httpStatus).toBe(first.httpStatus);

      const secondPrisma: PrismaService = secondModule.get(PRISMA_SERVICE);
      const mailboxCount = await secondPrisma.mailbox.count({ where: { organizationId: orgId } });
      const commandCount = await secondPrisma.integrationCommand.count({ where: { organizationId: orgId } });
      expect(mailboxCount).toBe(1);
      expect(commandCount).toBe(1);
    } finally {
      await secondModule.close();
    }
  });
});
