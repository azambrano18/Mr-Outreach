import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CrmClient } from '../../domain/crm-client/crm-client.entity';
import { PrismaAuditLogRepository } from '../../infrastructure/persistence/prisma/prisma-audit-log.repository';
import { PrismaCompanyRepository } from '../../infrastructure/persistence/prisma/prisma-company.repository';
import { PrismaContactRepository } from '../../infrastructure/persistence/prisma/prisma-contact.repository';
import { PrismaIntegrationCommandRepository } from '../../infrastructure/persistence/prisma/prisma-integration-command.repository';
import { PrismaManagedClientRepository } from '../../infrastructure/persistence/prisma/prisma-managed-client.repository';
import { PrismaSequenceContactRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-contact.repository';
import { PrismaSequenceImportRowRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-import-row.repository';
import { PrismaSequenceImportRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-import.repository';
import { PrismaSequenceStepRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-step.repository';
import { PrismaSequenceRepository } from '../../infrastructure/persistence/prisma/prisma-sequence.repository';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { assertTestDatabaseEnvironment } from '../../infrastructure/persistence/prisma/test-database-guard';
import { CrmClientEligibilityService } from '../crm-clients/crm-client-eligibility.service';
import { IdempotentOperationService } from '../idempotency/idempotent-operation.service';
import { IntegrationService } from '../integration/integration.service';
import { ConfirmProspectImportInput, ConfirmProspectImportUseCase } from './confirm-prospect-import.use-case';

/**
 * Fase 2, Caso B — real-PostgreSQL evidence for atomicity, bulk
 * materialization (no N+1), rollback, concurrency and idempotency. Built
 * by directly instantiating the Prisma repositories (same pattern as
 * restart-durability.integration.spec.ts) rather than the full AppModule,
 * so query counting via a logging-enabled PrismaClient is straightforward.
 * A minimal stand-in CRM eligibility service is used — the CRM check
 * itself is already covered elsewhere; this file's focus is the
 * transactional/bulk materialization behavior.
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

class FakeCrmEligibilityService {
  async getVerifiedActiveClient(): Promise<CrmClient> {
    return { crmClientId: 999001, name: 'Fixture', rut: null, rubro: null, status: 'ACTIVO' };
  }
}

class FakeIntegrationService {
  async dispatchExistingCommand(command: { status: string }) {
    return { ...command, status: 'ACCEPTED' };
  }
}

describeIfDatabaseAvailable('ConfirmProspectImportUseCase (PostgreSQL integration)', () => {
  let prisma: PrismaService;
  let loggingPrisma: PrismaClient & { queryCount: number };
  let useCase: ConfirmProspectImportUseCase;
  let orgId: string;
  let clientId: string;
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
    const org = await prisma.organization.create({ data: { name: `__fase2_case_b_${stamp}` } });
    orgId = org.id;
    const client = await prisma.managedClient.create({
      data: { organizationId: orgId, crmClientId: 999001, name: 'Cliente Fixture', createdBy: 'seed', updatedBy: 'seed' },
    });
    clientId = client.id;
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

    let queryCount = 0;
    loggingPrisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] }) as PrismaClient & {
      queryCount: number;
    };
    (loggingPrisma as unknown as { $on: (e: string, cb: () => void) => void }).$on('query', () => {
      queryCount += 1;
    });
    Object.defineProperty(loggingPrisma, 'queryCount', { get: () => queryCount });

    const managedClients = new PrismaManagedClientRepository(loggingPrisma as unknown as PrismaService);
    const companies = new PrismaCompanyRepository(loggingPrisma as unknown as PrismaService);
    const contacts = new PrismaContactRepository(loggingPrisma as unknown as PrismaService);
    const sequenceContacts = new PrismaSequenceContactRepository(loggingPrisma as unknown as PrismaService);
    const sequences = new PrismaSequenceRepository(loggingPrisma as unknown as PrismaService);
    const steps = new PrismaSequenceStepRepository(loggingPrisma as unknown as PrismaService);
    const imports = new PrismaSequenceImportRepository(loggingPrisma as unknown as PrismaService);
    const importRows = new PrismaSequenceImportRowRepository(loggingPrisma as unknown as PrismaService);
    const auditLogs: AuditLogRepository = new PrismaAuditLogRepository(loggingPrisma as unknown as PrismaService);
    const commands = new PrismaIntegrationCommandRepository(loggingPrisma as unknown as PrismaService);

    const { PrismaTransactionManager } = await import('../../infrastructure/persistence/prisma/prisma-transaction-manager');
    const tx = new PrismaTransactionManager(loggingPrisma as unknown as PrismaService);
    const idempotency = new IdempotentOperationService(commands);

    useCase = new ConfirmProspectImportUseCase(
      tx,
      imports,
      importRows,
      companies,
      contacts,
      sequenceContacts,
      sequences,
      steps,
      managedClients,
      auditLogs,
      new FakeCrmEligibilityService() as unknown as CrmClientEligibilityService,
      idempotency,
      new FakeIntegrationService() as unknown as IntegrationService,
    );
  });

  afterEach(async () => {
    await prisma.scheduledEmail.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceContact.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceImportRow.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceImport.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceStep.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequence.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedClient.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await loggingPrisma.$disconnect();
  });

  async function createImportWithRows(rowCount: number): Promise<string> {
    const importRow = await prisma.sequenceImport.create({
      data: {
        organizationId: orgId,
        clientId,
        sequenceId,
        executiveId: userId,
        mailboxId,
        status: 'READY',
        fileName: 'contactos.csv',
        storageKey: 'k',
        checksum: `chk_${randomUUID()}`,
        columnMapping: { email: 'email', customFields: { industria: 'ciudad' } },
        totalRows: rowCount,
        validRows: rowCount,
        createdBy: userId,
      },
    });
    const rows = Array.from({ length: rowCount }, (_, i) => ({
      organizationId: orgId,
      importId: importRow.id,
      rowNumber: i + 1,
      rawData: { email: `contacto${i}@empresa${i % 10}.cl`, ciudad: 'Santiago' },
      normalizedData: {
        email: `contacto${i}@empresa${i % 10}.cl`,
        firstName: `Nombre${i}`,
        lastName: null,
        fullName: null,
        companyRawName: `Empresa ${i % 10}`,
        jobTitle: null,
        phone: null,
        city: null,
        country: null,
        website: null,
        linkedin: null,
      },
      companyRawName: `Empresa ${i % 10}`,
      email: `contacto${i}@empresa${i % 10}.cl`,
      validationStatus: 'VALID' as const,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await prisma.sequenceImportRow.createMany({ data: rows.slice(i, i + 1000) });
    }
    return importRow.id;
  }

  function input(importId: string, overrides: Partial<ConfirmProspectImportInput> = {}): ConfirmProspectImportInput {
    return {
      organizationId: orgId,
      importId,
      sequenceId,
      actorId: userId,
      idempotencyKey: `key_${randomUUID()}`,
      ...overrides,
    };
  }

  it(
    'materializes 3000 rows (10 distinct companies) within the timeout, using a bounded number of SQL statements (no N+1)',
    async () => {
      const importId = await createImportWithRows(3000);
      const start = Date.now();
      const { result, httpStatus } = await useCase.execute(input(importId));
      const elapsedMs = Date.now() - start;

      expect(httpStatus).toBe(201);
      expect(result.totalProcessed).toBe(3000);
      expect(result.companiesCreated).toBe(10);
      expect(result.contactsCreated).toBe(3000);
      expect(result.contactsEnrolled).toBe(3000);

      const contactCount = await prisma.contact.count({ where: { organizationId: orgId } });
      const companyCount = await prisma.company.count({ where: { organizationId: orgId } });
      const enrolledCount = await prisma.sequenceContact.count({ where: { organizationId: orgId } });
      expect(contactCount).toBe(3000);
      expect(companyCount).toBe(10);
      expect(enrolledCount).toBe(3000);

      console.log(
        `[Fase 2, Caso B] 3000-row confirm: ${elapsedMs}ms elapsed, ~${loggingPrisma.queryCount} SQL statements`,
      );
      expect(elapsedMs).toBeLessThan(30_000);
      // Bulk-fetch/insert in batches of 500 across companies+contacts+enrollment+row-updates
      // (6 batches each) plus a handful of single-row reads/writes — nowhere near
      // one-query-per-row (which would be several thousand for 3000 rows).
      expect(loggingPrisma.queryCount).toBeLessThan(100);
    },
    60_000,
  );

  it('rejects 3001 rows with 400 before opening the transaction', async () => {
    const importId = await createImportWithRows(3001);
    await expect(useCase.execute(input(importId))).rejects.toThrow(/3001/);

    const importRow = await prisma.sequenceImport.findUnique({ where: { id: importId } });
    expect(importRow?.status).toBe('READY'); // untouched — rejected before any write
  }, 30_000);

  it('rolls back everything for real when a later step fails (forced FK violation on enrollment)', async () => {
    const importId = await createImportWithRows(5);
    // Delete the mailbox referenced by the sequence AFTER the import is
    // created, so SequenceContact creation's assignedMailboxId FK fails —
    // forcing a genuine mid-transaction Postgres error.
    await prisma.sequence.update({ where: { id: sequenceId }, data: { mailboxId: null } });

    await expect(useCase.execute(input(importId))).rejects.toThrow();

    const contactCount = await prisma.contact.count({ where: { organizationId: orgId } });
    const companyCount = await prisma.company.count({ where: { organizationId: orgId } });
    const importRow = await prisma.sequenceImport.findUnique({ where: { id: importId } });
    expect(contactCount).toBe(0);
    expect(companyCount).toBe(0);
    expect(importRow?.status).toBe('READY'); // conditional claim rolled back too
  });

  it('returns the exact same result on a retry with the same Idempotency-Key and payload, without duplicating anything', async () => {
    const importId = await createImportWithRows(5);
    const attempt = input(importId);
    const first = await useCase.execute(attempt);
    const second = await useCase.execute(attempt);

    expect(second.result).toEqual(first.result);
    const contactCount = await prisma.contact.count({ where: { organizationId: orgId } });
    expect(contactCount).toBe(5);
  });

  it('rejects the same Idempotency-Key reused for a different import as 409', async () => {
    const importIdA = await createImportWithRows(3);
    const importIdB = await createImportWithRows(3);
    const key = `key_${randomUUID()}`;
    await useCase.execute(input(importIdA, { idempotencyKey: key }));

    await expect(useCase.execute(input(importIdB, { idempotencyKey: key }))).rejects.toThrow(ConflictException);
  });

  it('produces a single materialization under real concurrency (two simultaneous confirmations of the same import)', async () => {
    const importId = await createImportWithRows(5);
    const attempt = input(importId);
    const [a, b] = await Promise.allSettled([useCase.execute(attempt), useCase.execute(attempt)]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    const contactCount = await prisma.contact.count({ where: { organizationId: orgId } });
    expect(contactCount).toBe(5);
  });

  it('persists custom variables (from mapping.customFields) onto Contact.customFields, reserved names excluded', async () => {
    const importRow = await prisma.sequenceImport.create({
      data: {
        organizationId: orgId,
        clientId,
        sequenceId,
        executiveId: userId,
        mailboxId,
        status: 'READY',
        fileName: 'c.csv',
        storageKey: 'k',
        checksum: `chk_${randomUUID()}`,
        columnMapping: { email: 'email', customFields: { industria: 'ciudad', empresa: 'empresa_col' } },
        totalRows: 1,
        validRows: 1,
        createdBy: userId,
      },
    });
    await prisma.sequenceImportRow.create({
      data: {
        organizationId: orgId,
        importId: importRow.id,
        rowNumber: 1,
        rawData: { email: 'variables@empresa.cl', ciudad: 'Valparaíso', empresa_col: 'Debe Ser Ignorado' },
        normalizedData: {
          email: 'variables@empresa.cl',
          firstName: 'Vari',
          lastName: null,
          fullName: null,
          companyRawName: 'Empresa Variables',
          jobTitle: null,
          phone: null,
          city: null,
          country: null,
          website: null,
          linkedin: null,
        },
        companyRawName: 'Empresa Variables',
        email: 'variables@empresa.cl',
        validationStatus: 'VALID',
      },
    });

    await useCase.execute(input(importRow.id));

    const contact = await prisma.contact.findFirst({ where: { organizationId: orgId, email: 'variables@empresa.cl' } });
    expect(contact?.customFields).toEqual({ industria: 'Valparaíso' });
  });

  it('survives a full restart: a brand-new, independent PrismaService connection still sees everything, including custom fields', async () => {
    const importId = await createImportWithRows(3);
    const { result: firstResult } = await useCase.execute(input(importId));

    // Simulate a full process shutdown: disconnect every connection this
    // test has used so far — a real teardown, not "another repository
    // reading the same in-process client".
    await loggingPrisma.$disconnect();
    await prisma.$disconnect();

    // A brand-new, independent PrismaService — new TCP connection, shares
    // nothing with the ones above beyond the database itself.
    const freshPrisma = new PrismaService();
    try {
      const contactCount = await freshPrisma.contact.count({ where: { organizationId: orgId } });
      const companyCount = await freshPrisma.company.count({ where: { organizationId: orgId } });
      const enrolledCount = await freshPrisma.sequenceContact.count({ where: { organizationId: orgId } });
      const importRow = await freshPrisma.sequenceImport.findUnique({ where: { id: importId } });
      const command = await freshPrisma.integrationCommand.findUnique({ where: { commandId: firstResult.commandId } });

      expect(contactCount).toBe(3);
      expect(companyCount).toBeGreaterThan(0);
      expect(enrolledCount).toBe(3);
      expect(importRow?.status).toBe('COMPLETED');
      expect(command).not.toBeNull();
      expect(command?.resultSnapshot).toBeTruthy();
    } finally {
      // Reconnect `prisma` for this test's own afterEach cleanup, and
      // replace loggingPrisma with a live connection too (afterEach
      // disconnects it again, harmlessly).
      prisma = freshPrisma;
      loggingPrisma = new PrismaClient({ log: [] }) as PrismaClient & { queryCount: number };
      Object.defineProperty(loggingPrisma, 'queryCount', { get: () => 0 });
    }
  }, 30_000);
});
