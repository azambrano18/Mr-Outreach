import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { assertTestDatabaseEnvironment } from '../../infrastructure/persistence/prisma/test-database-guard';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { PRISMA_SERVICE } from '../../infrastructure/persistence/tokens';
import { ConfigureMailboxInput, ConfigureMailboxUseCase } from './configure-mailbox.use-case';
import { UpdateMailboxConfigurationInput, UpdateMailboxConfigurationUseCase } from './update-mailbox-configuration.use-case';

/**
 * Fase 2 — real-PostgreSQL evidence for `UpdateMailboxConfigurationUseCase`,
 * the edit-side counterpart of Caso A. Runs only against mr-outreach-test
 * (`npm run test:integration`), CRM_DRIVER=mock throughout.
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

// Each test's beforeEach already calls ConfigureMailboxUseCase (dispatch +
// advance) before exercising the update itself — real network round-trips
// add up past the default 5s Jest timeout.
jest.setTimeout(30_000);

describeIfDatabaseAvailable('UpdateMailboxConfigurationUseCase (PostgreSQL integration)', () => {
  let moduleRef: TestingModule;
  let configureUseCase: ConfigureMailboxUseCase;
  let updateUseCase: UpdateMailboxConfigurationUseCase;
  let prisma: PrismaService;
  const stamp = Date.now();
  let orgId: string;
  let mailboxId: string;
  let clientId: string;

  beforeAll(async () => {
    assertTestDatabaseEnvironment();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    configureUseCase = moduleRef.get(ConfigureMailboxUseCase);
    updateUseCase = moduleRef.get(UpdateMailboxConfigurationUseCase);
    prisma = moduleRef.get(PRISMA_SERVICE);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `__fase2_case_a_edit_${stamp}_${randomUUID()}` } });
    orgId = org.id;

    const domainSuffix = randomUUID().slice(0, 6);
    const configureInput: ConfigureMailboxInput = {
      organizationId: orgId,
      crmClientId: 2001,
      domainName: `edit-${stamp}-${domainSuffix}.test`,
      email: `contacto@edit-${stamp}-${domainSuffix}.test`,
      fromName: 'Equipo de Ventas',
      imap: { host: 'imap.example.com', port: 993, encryption: 'SSL_TLS', username: 'contacto', password: 'imap-secret', verifyCertificate: true },
      smtp: { host: 'smtp.example.com', port: 587, encryption: 'STARTTLS', username: 'contacto', password: 'smtp-secret', verifyCertificate: true },
      actorId: 'admin_1',
      idempotencyKey: `key_${randomUUID()}`,
    };
    const { result } = await configureUseCase.execute(configureInput);
    mailboxId = result.mailboxId;
    clientId = result.clientId;
  });

  afterEach(async () => {
    await prisma.mailboxAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.signatureVersion.deleteMany({ where: { signature: { organizationId: orgId } } });
    await prisma.signature.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.domain.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientExecutiveAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedClient.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  function input(overrides: Partial<UpdateMailboxConfigurationInput> = {}): UpdateMailboxConfigurationInput {
    return {
      organizationId: orgId,
      mailboxId,
      actorId: 'admin_1',
      idempotencyKey: `key_${randomUUID()}`,
      ...overrides,
    };
  }

  it('a descriptive-only change (no password) commits and drives a NEW command to COMPLETED, updating lastProvisionCommandId', async () => {
    const before = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    const { result } = await updateUseCase.execute(input({ fromName: 'Nombre Actualizado' }));

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
    expect(after.fromName).toBe('Nombre Actualizado');
    expect(after.lastProvisionCommandId).not.toBe(before.lastProvisionCommandId);
    expect(after.lastProvisionCommandId).toBe(result.commandId);
    expect(after.provisioningStatus).toBe('PROVISIONED');
    expect(after.connectionStatus).toBe('CONNECTED');

    const command = await prisma.integrationCommand.findUnique({ where: { commandId: result.commandId } });
    expect(command?.status).toBe('COMPLETED');
    expect(command?.aggregateId).toBe(mailboxId);
  });

  it('an omitted password preserves the existing encrypted IMAP/SMTP credentials in Postgres', async () => {
    const before = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
    await updateUseCase.execute(input({ imap: { host: 'imap.nuevo.cl' } }));
    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    expect(after.imapHost).toBe('imap.nuevo.cl');
    expect(after.imapSecretCiphertext).toBe(before.imapSecretCiphertext); // untouched
  });

  it('a new password replaces the stored ciphertext', async () => {
    const before = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
    await updateUseCase.execute(input({ imap: { password: 'nuevo-secreto-imap' } }));
    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    expect(after.imapSecretCiphertext).not.toBe(before.imapSecretCiphertext);
    expect(after.imapSecretCiphertext).not.toContain('nuevo-secreto-imap'); // encrypted, never plaintext
  });

  it('assigns an executive that is authorized for the client, verified in Postgres', async () => {
    const user = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Exec', lastName: 'Uno', email: `exec-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'ACTIVE' },
    });
    await prisma.clientExecutiveAssignment.create({
      data: { organizationId: orgId, clientId, userId: user.id, role: 'PRIMARY', assignedBy: 'admin_1' },
    });

    await updateUseCase.execute(input({ primaryExecutiveId: user.id }));

    const assignment = await prisma.mailboxAssignment.findFirst({ where: { mailboxId, userId: user.id } });
    expect(assignment?.role).toBe('PRIMARY');
  });

  it('§10 — succeeds for an executive with no prior client assignment, and derives MAILBOX_DERIVED client visibility (real Postgres)', async () => {
    const user = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Sin', lastName: 'Asignar', email: `unassigned-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'ACTIVE' },
    });

    await updateUseCase.execute(input({ primaryExecutiveId: user.id, fromName: 'Se aplica igual' }));

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
    expect(after.fromName).toBe('Se aplica igual');
    const assignment = await prisma.mailboxAssignment.findFirst({ where: { mailboxId, userId: user.id } });
    expect(assignment?.role).toBe('PRIMARY');
    const visibility = await prisma.clientExecutiveAssignment.findUnique({
      where: { clientId_userId: { clientId, userId: user.id } },
    });
    expect(visibility?.visibilitySource).toBe('MAILBOX_DERIVED');
  });

  it('rolls back completely for an inactive executive (real Postgres, 409)', async () => {
    const user = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Inactivo', lastName: 'Uno', email: `inactive-${randomUUID()}@example.com`, passwordHash: 'hash', status: 'INACTIVE' },
    });

    const before = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
    await expect(updateUseCase.execute(input({ primaryExecutiveId: user.id, fromName: 'No debería aplicarse' }))).rejects.toThrow();

    const after = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
    expect(after.fromName).toBe(before.fromName); // untouched — whole transaction rolled back
    expect(after.lastProvisionCommandId).toBe(before.lastProvisionCommandId);
    const assignment = await prisma.mailboxAssignment.findFirst({ where: { mailboxId, userId: user.id } });
    expect(assignment).toBeNull();
  });

  it('returns the exact same result on a retry with the same Idempotency-Key and payload, never re-executing', async () => {
    const attempt = input({ fromName: 'Idempotente' });
    const first = await updateUseCase.execute(attempt);
    const second = await updateUseCase.execute(attempt);

    expect(second.result).toEqual(first.result);
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId, commandType: 'MAILBOX_PROVISION_REQUESTED' } });
    // 1 from the initial configure() in beforeEach + 1 from this update.
    expect(commandCount).toBe(2);
  });

  it('rejects the same Idempotency-Key reused with a different payload as 409', async () => {
    const key = `key_${randomUUID()}`;
    await updateUseCase.execute(input({ idempotencyKey: key, fromName: 'A' }));
    await expect(updateUseCase.execute(input({ idempotencyKey: key, fromName: 'B' }))).rejects.toThrow(ConflictException);
  });

  it('produces a single business effect under real concurrency (same key, same payload)', async () => {
    const attempt = input({ fromName: 'Concurrente' });
    const [a, b] = await Promise.allSettled([updateUseCase.execute(attempt), updateUseCase.execute(attempt)]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    if (a.status === 'fulfilled' && b.status === 'fulfilled') {
      expect(a.value.result.commandId).toBe(b.value.result.commandId);
    }
  });

  it('survives a full restart: a brand-new application context still returns the identical idempotent result', async () => {
    const attempt = input({ fromName: 'Sobrevive Reinicio' });
    const first = await updateUseCase.execute(attempt);

    await moduleRef.close();
    const restarted = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const restartedUseCase = restarted.get(UpdateMailboxConfigurationUseCase);
      const second = await restartedUseCase.execute(attempt);
      expect(second.result).toEqual(first.result);

      const restartedPrisma: PrismaService = restarted.get(PRISMA_SERVICE);
      const mailbox = await restartedPrisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
      expect(mailbox.lastProvisionCommandId).toBe(first.result.commandId);
    } finally {
      await restarted.close();
      // Re-open the shared module so this describe block's own afterAll/afterEach can still clean up via `prisma`.
      moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      prisma = moduleRef.get(PRISMA_SERVICE);
    }
  }, 30_000);
});
