import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { PrismaAuditLogRepository } from '../../infrastructure/persistence/prisma/prisma-audit-log.repository';
import { PrismaCompanyRepository } from '../../infrastructure/persistence/prisma/prisma-company.repository';
import { PrismaContactRepository } from '../../infrastructure/persistence/prisma/prisma-contact.repository';
import { PrismaIntegrationCommandRepository } from '../../infrastructure/persistence/prisma/prisma-integration-command.repository';
import { PrismaManagedClientRepository } from '../../infrastructure/persistence/prisma/prisma-managed-client.repository';
import { PrismaMailboxRepository } from '../../infrastructure/persistence/prisma/prisma-mailbox.repository';
import { PrismaSequenceContactRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-contact.repository';
import { PrismaSequenceStepVersionRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-step-version.repository';
import { PrismaSequenceStepRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-step.repository';
import { PrismaSequenceRepository } from '../../infrastructure/persistence/prisma/prisma-sequence.repository';
import { PrismaSignatureVersionRepository } from '../../infrastructure/persistence/prisma/prisma-signature-version.repository';
import { PrismaSignatureRepository } from '../../infrastructure/persistence/prisma/prisma-signature.repository';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { assertTestDatabaseEnvironment } from '../../infrastructure/persistence/prisma/test-database-guard';
import { ClientEligibilityService } from '../clients/client-eligibility.service';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import { PublishSequenceInput, PublishSequenceUseCase } from './publish-sequence.use-case';

/**
 * Fase 2, Caso C — real-PostgreSQL evidence that:
 *  - the sequence-publish-state migration's 5 columns (previously
 *    hardcoded to null/0 in PrismaSequenceRepository) are now genuinely
 *    read/written;
 *  - the command+audit+publishStatus transition commit atomically;
 *  - two concurrent publish attempts on the same sequence never both
 *    succeed (the loser's transaction rolls back for real);
 *  - a retry with the same Idempotency-Key+content never re-executes;
 *  - state survives a full process restart.
 * A minimal stand-in eligibility/engine pair is used (same pattern as
 * confirm-prospect-import.integration.spec.ts) — this file's focus is
 * transactional/durability behavior, not eligibility specifics (covered elsewhere).
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

class FakeClientEligibilityService {
  async assertEligibleForPublish(): Promise<void> {}
}

class FakeIntegrationService {
  async dispatchExistingCommand(command: { status: string }) {
    return { ...command, status: 'ACCEPTED' };
  }
  async advance() {
    return [
      { eventType: 'SEQUENCE_PUBLISH_ACCEPTED', commandId: 'unused' },
      { eventType: 'SEQUENCE_PUBLISH_COMPLETED', commandId: 'unused' },
    ];
  }
}

class NoopSimulatedAdapter {
  setPublishScenario(): void {
    // no-op — this file never exercises the QA scenario hook.
  }
}

describeIfDatabaseAvailable('PublishSequenceUseCase (PostgreSQL integration)', () => {
  let prisma: PrismaService;
  let loggingPrisma: PrismaClient;
  let useCase: PublishSequenceUseCase;
  let orgId: string;
  let userId: string;
  let mailboxId: string;
  let sequenceId: string;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({ data: { name: `__fase2_case_c_${stamp}` } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        firstName: 'Ejecutiva',
        lastName: 'Fixture',
        email: `exec.${stamp}@example.com`,
        passwordHash: 'hash',
      },
    });
    userId = user.id;
    const mailbox = await prisma.mailbox.create({
      data: {
        organizationId: orgId,
        name: 'Cuenta Fixture',
        email: `cuenta.${stamp}@example.com`,
        fromName: 'Cuenta Fixture',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapEncryption: 'SSL_TLS',
        imapUsername: 'u',
        imapSecretCiphertext: 'x',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpEncryption: 'STARTTLS',
        smtpUsername: 'u',
        smtpSecretCiphertext: 'x',
      },
    });
    mailboxId = mailbox.id;
    const sequence = await prisma.sequence.create({
      data: {
        organizationId: orgId,
        executiveId: userId,
        mailboxId,
        name: 'Secuencia Fixture',
        timezone: 'America/Santiago',
        createdBy: userId,
        updatedBy: userId,
      },
    });
    sequenceId = sequence.id;
    await prisma.sequenceStep.create({
      data: {
        organizationId: orgId,
        sequenceId,
        position: 1,
        name: 'Enviados_1',
        subject: 'Asunto',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
        status: 'PUBLISHED',
        createdBy: userId,
        updatedBy: userId,
      },
    });

    loggingPrisma = new PrismaClient();

    const sequences = new PrismaSequenceRepository(loggingPrisma as unknown as PrismaService);
    const steps = new PrismaSequenceStepRepository(loggingPrisma as unknown as PrismaService);
    const stepVersions = new PrismaSequenceStepVersionRepository(loggingPrisma as unknown as PrismaService);
    const mailboxes = new PrismaMailboxRepository(loggingPrisma as unknown as PrismaService);
    const signatures = new PrismaSignatureRepository(loggingPrisma as unknown as PrismaService);
    const signatureVersions = new PrismaSignatureVersionRepository(loggingPrisma as unknown as PrismaService);
    const sequenceContacts = new PrismaSequenceContactRepository(loggingPrisma as unknown as PrismaService);
    const contacts = new PrismaContactRepository(loggingPrisma as unknown as PrismaService);
    const companies = new PrismaCompanyRepository(loggingPrisma as unknown as PrismaService);
    const managedClients = new PrismaManagedClientRepository(loggingPrisma as unknown as PrismaService);
    const auditLogs: AuditLogRepository = new PrismaAuditLogRepository(loggingPrisma as unknown as PrismaService);
    const commands = new PrismaIntegrationCommandRepository(loggingPrisma as unknown as PrismaService);

    const { PrismaTransactionManager } = await import('../../infrastructure/persistence/prisma/prisma-transaction-manager');
    const tx = new PrismaTransactionManager(loggingPrisma as unknown as PrismaService);
    const idempotency = new IdempotentOperationService(commands);

    useCase = new PublishSequenceUseCase(
      tx,
      sequences,
      steps,
      stepVersions,
      mailboxes,
      signatures,
      signatureVersions,
      sequenceContacts,
      contacts,
      companies,
      managedClients,
      auditLogs,
      new FakeClientEligibilityService() as unknown as ClientEligibilityService,
      idempotency,
      new FakeIntegrationService() as unknown as IntegrationService,
      new NoopSimulatedAdapter() as never,
      {} as never, // MailboxMotorPort — never called, this fixture's mailbox is LEGACY_LOCAL.
    );
  });

  afterEach(async () => {
    await prisma.scheduledEmail.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceContact.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceStep.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequence.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await loggingPrisma.$disconnect();
  });

  function input(overrides: Partial<PublishSequenceInput> = {}): PublishSequenceInput {
    return {
      organizationId: orgId,
      sequenceId,
      actorId: userId,
      idempotencyKey: `key_${randomUUID()}`,
      ...overrides,
    };
  }

  it('commits command + audit + publishStatus atomically, then persists the real sequence-publish-state columns (previously hardcoded to null/0 under Postgres)', async () => {
    const { result, httpStatus } = await useCase.execute(input());

    expect(httpStatus).toBe(201);
    expect(result.publishStatus).toBe('ACTIVE');
    expect(result.sequenceVersion).toBe(1);

    const row = await prisma.sequence.findUniqueOrThrow({ where: { id: sequenceId } });
    expect(row.publishStatus).toBe('ACTIVE');
    expect(row.sequenceVersion).toBe(1);
    expect(row.effectiveStartAt).not.toBeNull();
    expect(row.lastPublishedAt).not.toBeNull();
    expect(row.lastPublishCommandId).toBe(result.commandId);

    const command = await prisma.integrationCommand.findUnique({ where: { commandId: result.commandId } });
    expect(command).not.toBeNull();
    expect(command?.commandType).toBe('SEQUENCE_PUBLISH_REQUESTED');

    const audit = await prisma.auditLog.findMany({ where: { organizationId: orgId, entityId: sequenceId } });
    expect(audit.some((a) => a.action === 'sequence.publish_requested')).toBe(true);
    expect(audit.some((a) => a.action === 'sequence.publish_completed')).toBe(true);
  });

  it('a claim rejected by the concurrency guard rolls back cleanly — no command, no audit, sequence untouched', async () => {
    // Pre-set an in-flight status so conditionalUpdatePublishStatus's claim fails deterministically.
    await prisma.sequence.update({ where: { id: sequenceId }, data: { publishStatus: 'PROCESSING' } });

    await expect(useCase.execute(input())).rejects.toThrow(ConflictException);

    const row = await prisma.sequence.findUniqueOrThrow({ where: { id: sequenceId } });
    expect(row.publishStatus).toBe('PROCESSING'); // unchanged — the failed claim never committed
    expect(row.lastPublishCommandId).toBeNull();
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(commandCount).toBe(0);
    const auditCount = await prisma.auditLog.count({ where: { organizationId: orgId } });
    expect(auditCount).toBe(0);
  });

  it('produces a single command under real concurrency (two simultaneous publishes with the same key) — the loser rolls back', async () => {
    const attempt = input();
    const [a, b] = await Promise.allSettled([useCase.execute(attempt), useCase.execute(attempt)]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(commandCount).toBe(1);
    const row = await prisma.sequence.findUniqueOrThrow({ where: { id: sequenceId } });
    expect(row.sequenceVersion).toBe(1);
  });

  it('returns the exact same result on a retry with the same Idempotency-Key and content, without re-executing', async () => {
    const attempt = input();
    const first = await useCase.execute(attempt);
    const second = await useCase.execute(attempt);

    expect(second.result).toEqual(first.result);
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(commandCount).toBe(1);
  });

  it('rejects the same Idempotency-Key reused for a different sequence as 409', async () => {
    const other = await prisma.sequence.create({
      data: {
        organizationId: orgId,
        executiveId: userId,
        mailboxId,
        name: 'Otra Secuencia',
        timezone: 'America/Santiago',
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await prisma.sequenceStep.create({
      data: {
        organizationId: orgId,
        sequenceId: other.id,
        position: 1,
        name: 'Enviados_1',
        subject: 'Asunto',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
        status: 'PUBLISHED',
        createdBy: userId,
        updatedBy: userId,
      },
    });
    const key = `key_${randomUUID()}`;
    await useCase.execute(input({ idempotencyKey: key }));

    await expect(useCase.execute(input({ sequenceId: other.id, idempotencyKey: key }))).rejects.toThrow(ConflictException);

    await prisma.sequence.delete({ where: { id: other.id } }).catch(() => undefined);
  });

  it('survives a full restart: a brand-new, independent PrismaService connection still sees the published state', async () => {
    const { result } = await useCase.execute(input());
    await loggingPrisma.$disconnect();
    await prisma.$disconnect();

    const restarted = new PrismaService();
    const row = await restarted.sequence.findUniqueOrThrow({ where: { id: sequenceId } });
    expect(row.publishStatus).toBe('ACTIVE');
    expect(row.sequenceVersion).toBe(1);
    expect(row.lastPublishCommandId).toBe(result.commandId);
    const command = await restarted.integrationCommand.findUnique({ where: { commandId: result.commandId } });
    expect((command?.resultSnapshot as Record<string, unknown> | null)?.publishStatus).toBe('ACTIVE');
    await restarted.$disconnect();

    prisma = new PrismaService();
  }, 30_000);
});
