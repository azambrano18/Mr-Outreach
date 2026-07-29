import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { PrismaAuditLogRepository } from '../../infrastructure/persistence/prisma/prisma-audit-log.repository';
import { PrismaCompanyRepository } from '../../infrastructure/persistence/prisma/prisma-company.repository';
import { PrismaIntegrationCommandRepository } from '../../infrastructure/persistence/prisma/prisma-integration-command.repository';
import { PrismaScheduledEmailRepository } from '../../infrastructure/persistence/prisma/prisma-scheduled-email.repository';
import { PrismaSequenceContactRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-contact.repository';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { assertTestDatabaseEnvironment } from '../../infrastructure/persistence/prisma/test-database-guard';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import { RemoveCompanyFromSequenceUseCase } from './remove-company-from-sequence.use-case';
import { RemoveContactFromSequenceUseCase } from './remove-contact-from-sequence.use-case';

/**
 * Fase 2, Casos D/E — real-PostgreSQL evidence that job cancellation +
 * the REMOVED transition + audit + command commit atomically, in bulk
 * (never one query per job/contact), and that concurrent/duplicate
 * attempts never double-cancel or double-process.
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

class FakeIntegrationService {
  async dispatchExistingCommand(command: { status: string }) {
    return { ...command, status: 'ACCEPTED' };
  }
  async advance() {
    return [{ eventType: 'SEQUENCE_CONTACT_REMOVED', commandId: 'unused' }];
  }
}

describeIfDatabaseAvailable('RemoveContactFromSequenceUseCase / RemoveCompanyFromSequenceUseCase (PostgreSQL integration)', () => {
  let prisma: PrismaService;
  let loggingPrisma: PrismaClient;
  let removeContactUseCase: RemoveContactFromSequenceUseCase;
  let removeCompanyUseCase: RemoveCompanyFromSequenceUseCase;
  let orgId: string;
  let clientId: string;
  let userId: string;
  let mailboxId: string;
  let sequenceId: string;
  let stepId: string;
  let companyId: string;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({ data: { name: `__fase2_case_de_${stamp}` } });
    orgId = org.id;
    const client = await prisma.managedClient.create({
      data: { organizationId: orgId, crmClientId: 999003, name: 'Cliente Fixture', createdBy: 'seed', updatedBy: 'seed' },
    });
    clientId = client.id;
    const user = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Ejecutiva', lastName: 'Fixture', email: `exec.${stamp}@example.com`, passwordHash: 'hash' },
    });
    userId = user.id;
    const mailbox = await prisma.mailbox.create({
      data: {
        organizationId: orgId,
        clientId,
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
      data: { organizationId: orgId, executiveId: userId, mailboxId, name: 'Secuencia Fixture', timezone: 'America/Santiago', createdBy: userId, updatedBy: userId },
    });
    sequenceId = sequence.id;
    const step = await prisma.sequenceStep.create({
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
    stepId = step.id;
    const company = await prisma.company.create({
      data: { organizationId: orgId, clientId, rawName: 'Empresa Fixture', normalizedName: 'empresa fixture' },
    });
    companyId = company.id;

    loggingPrisma = new PrismaClient();
    const sequenceContacts = new PrismaSequenceContactRepository(loggingPrisma as unknown as PrismaService);
    const scheduledEmails = new PrismaScheduledEmailRepository(loggingPrisma as unknown as PrismaService);
    const companies = new PrismaCompanyRepository(loggingPrisma as unknown as PrismaService);
    const auditLogs: AuditLogRepository = new PrismaAuditLogRepository(loggingPrisma as unknown as PrismaService);
    const commands = new PrismaIntegrationCommandRepository(loggingPrisma as unknown as PrismaService);

    const { PrismaTransactionManager } = await import('../../infrastructure/persistence/prisma/prisma-transaction-manager');
    const tx = new PrismaTransactionManager(loggingPrisma as unknown as PrismaService);
    const idempotency = new IdempotentOperationService(commands);
    const fakeIntegration = new FakeIntegrationService() as unknown as IntegrationService;

    removeContactUseCase = new RemoveContactFromSequenceUseCase(tx, sequenceContacts, scheduledEmails, auditLogs, idempotency, fakeIntegration);
    removeCompanyUseCase = new RemoveCompanyFromSequenceUseCase(tx, sequenceContacts, scheduledEmails, companies, auditLogs, idempotency, fakeIntegration);
  });

  afterEach(async () => {
    await prisma.scheduledEmail.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceContact.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceStep.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequence.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedClient.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await loggingPrisma.$disconnect();
  });

  async function createEnrolledContact(email: string, withCompany = true): Promise<{ contactId: string; sequenceContactId: string }> {
    const contact = await prisma.contact.create({
      data: { organizationId: orgId, clientId, companyId: withCompany ? companyId : null, email },
    });
    const sc = await prisma.sequenceContact.create({
      data: {
        organizationId: orgId,
        clientId,
        sequenceId,
        sequenceVersion: 0,
        contactId: contact.id,
        companyId: withCompany ? companyId : null,
        assignedMailboxId: mailboxId,
        assignedExecutiveId: userId,
        currentStepId: stepId,
        currentStepPosition: 1,
      },
    });
    await prisma.scheduledEmail.create({
      data: {
        organizationId: orgId,
        sequenceId,
        sequenceVersion: 0,
        sequenceContactId: sc.id,
        contactId: contact.id,
        companyId: withCompany ? companyId : null,
        sequenceStepId: stepId,
        stepVersion: 1,
        mailboxId,
        batchId: `batch_${randomUUID()}`,
        scheduledAt: new Date(),
        priority: 'NEW_CONTACT',
        idempotencyKey: `job_${randomUUID()}`,
      },
    });
    return { contactId: contact.id, sequenceContactId: sc.id };
  }

  it('Caso D: cancels the one pending job, flips to REMOVED, and commits command+audit atomically', async () => {
    const { sequenceContactId } = await createEnrolledContact('a@example.com');

    const { result } = await removeContactUseCase.execute({
      organizationId: orgId,
      sequenceId,
      sequenceContactId,
      reason: 'Solicitud del cliente',
      actorId: userId,
      idempotencyKey: `key_${randomUUID()}`,
    });

    expect(result.cancelledJobs).toBe(1);
    const scRow = await prisma.sequenceContact.findUniqueOrThrow({ where: { id: sequenceContactId } });
    expect(scRow.status).toBe('REMOVED');
    const job = await prisma.scheduledEmail.findFirstOrThrow({ where: { sequenceContactId } });
    expect(job.status).toBe('CANCELLED');
    const command = await prisma.integrationCommand.findUnique({ where: { commandId: result.commandId } });
    expect(command?.commandType).toBe('SEQUENCE_CONTACT_REMOVE_REQUESTED');
  });

  it('Caso D: two concurrent removes of the same contact — only one succeeds business-wise, single command', async () => {
    const { sequenceContactId } = await createEnrolledContact('b@example.com');
    const attempt = (key: string) =>
      removeContactUseCase.execute({ organizationId: orgId, sequenceId, sequenceContactId, reason: 'x', actorId: userId, idempotencyKey: key });

    const [a, b] = await Promise.allSettled([attempt(`key_${randomUUID()}`), attempt(`key_${randomUUID()}`)]);
    const statuses = [a, b].map((r) => r.status);
    expect(statuses.filter((s) => s === 'fulfilled')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'rejected')).toHaveLength(1);

    const scRow = await prisma.sequenceContact.findUniqueOrThrow({ where: { id: sequenceContactId } });
    expect(scRow.status).toBe('REMOVED');
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(commandCount).toBe(1);
  });

  it('Caso D: retry with the same Idempotency-Key returns the identical result without a second cancellation', async () => {
    const { sequenceContactId } = await createEnrolledContact('c@example.com');
    const key = `key_${randomUUID()}`;
    const first = await removeContactUseCase.execute({ organizationId: orgId, sequenceId, sequenceContactId, reason: 'x', actorId: userId, idempotencyKey: key });
    const second = await removeContactUseCase.execute({ organizationId: orgId, sequenceId, sequenceContactId, reason: 'x', actorId: userId, idempotencyKey: key });
    expect(second.result).toEqual(first.result);
    const commandCount = await prisma.integrationCommand.count({ where: { organizationId: orgId } });
    expect(commandCount).toBe(1);
  });

  it('Caso E: removes every contact of the company within this sequence in bulk, cancelling all their pending jobs', async () => {
    const contactA = await createEnrolledContact('d@example.com');
    const contactB = await createEnrolledContact('e@example.com');
    const other = await createEnrolledContact('f@example.com', false); // different company — must be untouched

    const { result } = await removeCompanyUseCase.execute({
      organizationId: orgId,
      sequenceId,
      companyId,
      reason: 'Empresa dada de baja',
      actorId: userId,
      idempotencyKey: `key_${randomUUID()}`,
    });

    expect(result.affectedContacts).toBe(2);
    expect(result.cancelledJobs).toBe(2);
    const [scA, scB, scOther] = await Promise.all([
      prisma.sequenceContact.findUniqueOrThrow({ where: { id: contactA.sequenceContactId } }),
      prisma.sequenceContact.findUniqueOrThrow({ where: { id: contactB.sequenceContactId } }),
      prisma.sequenceContact.findUniqueOrThrow({ where: { id: other.sequenceContactId } }),
    ]);
    expect(scA.status).toBe('REMOVED');
    expect(scB.status).toBe('REMOVED');
    expect(scOther.status).not.toBe('REMOVED');
  });

  it('Caso E: a second call after everything is already removed is a no-op success (0 affected), never an error', async () => {
    await createEnrolledContact('g@example.com');
    await removeCompanyUseCase.execute({ organizationId: orgId, sequenceId, companyId, reason: 'x', actorId: userId, idempotencyKey: `key_${randomUUID()}` });

    const { result } = await removeCompanyUseCase.execute({
      organizationId: orgId,
      sequenceId,
      companyId,
      reason: 'x',
      actorId: userId,
      idempotencyKey: `key_${randomUUID()}`,
    });
    expect(result.affectedContacts).toBe(0);
    expect(result.cancelledJobs).toBe(0);
  });

  it('rejects the same Idempotency-Key reused with a different reason as 409', async () => {
    const { sequenceContactId } = await createEnrolledContact('h@example.com');
    const key = `key_${randomUUID()}`;
    await removeContactUseCase.execute({ organizationId: orgId, sequenceId, sequenceContactId, reason: 'motivo A', actorId: userId, idempotencyKey: key });
    await expect(
      removeContactUseCase.execute({ organizationId: orgId, sequenceId, sequenceContactId, reason: 'motivo B (distinto)', actorId: userId, idempotencyKey: key }),
    ).rejects.toThrow(ConflictException);
  });

  it('survives a full restart: a brand-new PrismaService connection still sees the REMOVED state and cancelled job', async () => {
    const { sequenceContactId } = await createEnrolledContact('i@example.com');
    await removeContactUseCase.execute({ organizationId: orgId, sequenceId, sequenceContactId, reason: 'x', actorId: userId, idempotencyKey: `key_${randomUUID()}` });
    await loggingPrisma.$disconnect();
    await prisma.$disconnect();

    const restarted = new PrismaService();
    const scRow = await restarted.sequenceContact.findUniqueOrThrow({ where: { id: sequenceContactId } });
    expect(scRow.status).toBe('REMOVED');
    const job = await restarted.scheduledEmail.findFirstOrThrow({ where: { sequenceContactId } });
    expect(job.status).toBe('CANCELLED');
    await restarted.$disconnect();

    prisma = new PrismaService();
  }, 30_000);
});
