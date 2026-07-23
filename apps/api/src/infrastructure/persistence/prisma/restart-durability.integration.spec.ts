import { PrismaService } from './prisma.service';
import { PrismaIntegrationCommandRepository } from './prisma-integration-command.repository';
import { PrismaIntegrationEventRepository } from './prisma-integration-event.repository';
import { PrismaSequenceImportRepository } from './prisma-sequence-import.repository';
import { PrismaContactRepository } from './prisma-contact.repository';
import { PrismaSequenceContactRepository } from './prisma-sequence-contact.repository';
import { PrismaScheduledEmailRepository } from './prisma-scheduled-email.repository';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedContacts, seedFullChain } from './test-fixtures';

/**
 * Fase 1 — criterios de aceptación #6-13: demuestra que los comandos,
 * eventos, importaciones, contactos, relaciones contacto-secuencia y
 * trabajos programados sobreviven a un reinicio real de la API, no solo a
 * que "otro repositorio los pueda leer en el mismo proceso". Escribe con
 * una instancia de PrismaService, la desconecta por completo (simulando
 * el apagado del proceso), crea una instancia SEGUNDA y NUEVA, y confirma
 * que los datos siguen ahí — la única forma en que eso puede pasar es que
 * realmente estén en PostgreSQL, no en memoria de proceso.
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PostgreSQL restart durability (Fase 1)', () => {
  let writerPrisma: PrismaService;

  const commandId = 'cmd_restart_test';
  const idempotencyKey = 'restart-test-idempotency-key';
  let createdCommandRowId: string;
  let createdImportId: string;
  let createdContactId: string;
  let createdSequenceContactId: string;
  let createdScheduledEmailId: string;

  beforeAll(async () => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

    writerPrisma = new PrismaService();
    await writerPrisma.integrationEvent.deleteMany();
    await writerPrisma.integrationCommand.deleteMany({ where: { commandId } });
    await writerPrisma.scheduledEmail.deleteMany();
    await writerPrisma.sequenceContact.deleteMany();
    await writerPrisma.sequenceImport.deleteMany();
    await seedFullChain(writerPrisma);
    await seedContacts(writerPrisma);

    const commands = new PrismaIntegrationCommandRepository(writerPrisma);
    const events = new PrismaIntegrationEventRepository(writerPrisma);
    const imports = new PrismaSequenceImportRepository(writerPrisma);
    const contacts = new PrismaContactRepository(writerPrisma);
    const sequenceContacts = new PrismaSequenceContactRepository(writerPrisma);
    const scheduledEmails = new PrismaScheduledEmailRepository(writerPrisma);

    // 1. A command.
    const command = await commands.create({
      organizationId: 'fx_org_1',
      commandId,
      commandType: 'SEQUENCE_IMPORT_REQUESTED',
      aggregateType: 'SEQUENCE_IMPORT',
      aggregateId: 'fx_import_restart',
      schemaVersion: '1.0',
      idempotencyKey,
      correlationId: 'corr_restart_test',
      payload: { storageReference: { storageKey: 'import_restart_test' } },
      requestedBy: 'fx_user_1',
    });
    createdCommandRowId = command.id;

    // 2. Its events.
    await events.create({
      organizationId: 'fx_org_1',
      eventId: 'evt_restart_accepted',
      eventType: 'SEQUENCE_IMPORT_ACCEPTED',
      commandId,
      correlationId: 'corr_restart_test',
      schemaVersion: '1.0',
      payload: {},
      origin: 'SIMULATED',
    });
    await events.create({
      organizationId: 'fx_org_1',
      eventId: 'evt_restart_completed',
      eventType: 'SEQUENCE_IMPORT_COMPLETED',
      commandId,
      correlationId: 'corr_restart_test',
      schemaVersion: '1.0',
      payload: {},
      origin: 'SIMULATED',
    });

    // 3. An import.
    const importRow = await imports.create({
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      sequenceId: 'fx_sequence_1',
      executiveId: 'fx_user_1',
      mailboxId: 'fx_mailbox_1',
      fileName: 'restart-test.xlsx',
      storageKey: 'import_restart_test',
      checksum: 'restart-checksum',
      totalRows: 1,
      createdBy: 'fx_user_1',
    });
    createdImportId = importRow.id;

    // 4. A contact.
    const contact = await contacts.create({
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      companyId: null,
      email: 'restart-durability@example.com',
      firstName: 'Restart',
      customFields: { origin: 'restart-durability-test' },
    });
    createdContactId = contact.id;

    // 5. A contact-sequence relationship.
    const sequenceContact = await sequenceContacts.create({
      organizationId: 'fx_org_1',
      clientId: 'fx_client_1',
      sequenceId: 'fx_sequence_1',
      sequenceVersion: 1,
      contactId: contact.id,
      companyId: null,
      sourceImportId: importRow.id,
      assignedMailboxId: 'fx_mailbox_1',
      assignedExecutiveId: 'fx_user_1',
      currentStepId: 'fx_step_1',
      currentStepPosition: 1,
    });
    createdSequenceContactId = sequenceContact.id;

    // 6. A scheduled job.
    const scheduledEmail = await scheduledEmails.create({
      organizationId: 'fx_org_1',
      sequenceId: 'fx_sequence_1',
      sequenceVersion: 1,
      sequenceContactId: sequenceContact.id,
      contactId: contact.id,
      companyId: null,
      sequenceStepId: 'fx_step_1',
      stepVersion: 1,
      mailboxId: 'fx_mailbox_1',
      batchId: 'batch_restart_test',
      scheduledAt: new Date('2026-01-01T10:00:00Z'),
      priority: 'NEW_CONTACT',
      idempotencyKey: 'scheduled-email:restart-test',
    });
    createdScheduledEmailId = scheduledEmail.id;

    // Simulate the API process shutting down completely.
    await writerPrisma.$disconnect();
  });

  afterAll(async () => {
    const cleanupPrisma = new PrismaService();
    await cleanupPrisma.scheduledEmail.deleteMany({ where: { id: createdScheduledEmailId } });
    await cleanupPrisma.sequenceContact.deleteMany({ where: { id: createdSequenceContactId } });
    await cleanupPrisma.sequenceImport.deleteMany({ where: { id: createdImportId } });
    await cleanupPrisma.contact.deleteMany({ where: { id: createdContactId } });
    await cleanupPrisma.integrationEvent.deleteMany({ where: { commandId } });
    await cleanupPrisma.integrationCommand.deleteMany({ where: { commandId } });
    await cleanupPrisma.$disconnect();
  });

  it('recovers the command from a brand-new PrismaService instance', async () => {
    const freshPrisma = new PrismaService();
    const commands = new PrismaIntegrationCommandRepository(freshPrisma);

    const recovered = await commands.findById(createdCommandRowId);

    expect(recovered).not.toBeNull();
    expect(recovered?.commandId).toBe(commandId);
    expect(recovered?.idempotencyKey).toBe(idempotencyKey);
    expect(recovered?.payload).toEqual({ storageReference: { storageKey: 'import_restart_test' } });

    await freshPrisma.$disconnect();
  });

  it('recovers both events for the command from a brand-new PrismaService instance', async () => {
    const freshPrisma = new PrismaService();
    const events = new PrismaIntegrationEventRepository(freshPrisma);

    const recovered = await events.findAll('fx_org_1', { commandId });

    expect(recovered).toHaveLength(2);
    expect(recovered.map((e) => e.eventType).sort()).toEqual(
      ['SEQUENCE_IMPORT_ACCEPTED', 'SEQUENCE_IMPORT_COMPLETED'].sort(),
    );

    await freshPrisma.$disconnect();
  });

  it('recovers the import from a brand-new PrismaService instance', async () => {
    const freshPrisma = new PrismaService();
    const imports = new PrismaSequenceImportRepository(freshPrisma);

    const recovered = await imports.findById(createdImportId);

    expect(recovered).not.toBeNull();
    expect(recovered?.fileName).toBe('restart-test.xlsx');
    expect(recovered?.checksum).toBe('restart-checksum');

    await freshPrisma.$disconnect();
  });

  it('recovers the contact (with custom fields) from a brand-new PrismaService instance', async () => {
    const freshPrisma = new PrismaService();
    const contacts = new PrismaContactRepository(freshPrisma);

    const recovered = await contacts.findById(createdContactId);

    expect(recovered).not.toBeNull();
    expect(recovered?.email).toBe('restart-durability@example.com');
    expect(recovered?.customFields).toEqual({ origin: 'restart-durability-test' });

    await freshPrisma.$disconnect();
  });

  it('recovers the sequence-contact relationship from a brand-new PrismaService instance', async () => {
    const freshPrisma = new PrismaService();
    const sequenceContacts = new PrismaSequenceContactRepository(freshPrisma);

    const recovered = await sequenceContacts.findById(createdSequenceContactId);

    expect(recovered).not.toBeNull();
    expect(recovered?.contactId).toBe(createdContactId);
    expect(recovered?.sourceImportId).toBe(createdImportId);
    expect(recovered?.status).toBe('ACTIVE');

    await freshPrisma.$disconnect();
  });

  it('recovers the scheduled job from a brand-new PrismaService instance', async () => {
    const freshPrisma = new PrismaService();
    const scheduledEmails = new PrismaScheduledEmailRepository(freshPrisma);

    const recovered = await scheduledEmails.findById(createdScheduledEmailId);

    expect(recovered).not.toBeNull();
    expect(recovered?.status).toBe('PENDING');
    expect(recovered?.batchId).toBe('batch_restart_test');
    expect(recovered?.sequenceContactId).toBe(createdSequenceContactId);

    await freshPrisma.$disconnect();
  });
});
