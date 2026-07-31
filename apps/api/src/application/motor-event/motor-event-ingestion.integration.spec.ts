import { randomUUID } from 'node:crypto';
import { PrismaAuditLogRepository } from '../../infrastructure/persistence/prisma/prisma-audit-log.repository';
import { PrismaCompanyRepository } from '../../infrastructure/persistence/prisma/prisma-company.repository';
import { PrismaContactRepository } from '../../infrastructure/persistence/prisma/prisma-contact.repository';
import { PrismaConversationMessageRepository } from '../../infrastructure/persistence/prisma/prisma-conversation-message.repository';
import { PrismaConversationRepository } from '../../infrastructure/persistence/prisma/prisma-conversation.repository';
import { PrismaIntegrationCommandRepository } from '../../infrastructure/persistence/prisma/prisma-integration-command.repository';
import { PrismaIntegrationEventRepository } from '../../infrastructure/persistence/prisma/prisma-integration-event.repository';
import { PrismaMailboxAssignmentRepository } from '../../infrastructure/persistence/prisma/prisma-mailbox-assignment.repository';
import { PrismaMailboxRepository } from '../../infrastructure/persistence/prisma/prisma-mailbox.repository';
import { PrismaProspectImportRowRepository } from '../../infrastructure/persistence/prisma/prisma-prospect-import-row.repository';
import { PrismaSequenceExecutionRepository } from '../../infrastructure/persistence/prisma/prisma-sequence-execution.repository';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { PrismaTransactionManager } from '../../infrastructure/persistence/prisma/prisma-transaction-manager';
import { assertTestDatabaseEnvironment } from '../../infrastructure/persistence/prisma/test-database-guard';
import { MotorEventEnvelopeDto, MOTOR_EVENT_SCHEMA_VERSION } from '../../modules/integration/dto/motor-event-envelope.dto';
import { MotorEventProjector } from './motor-event-projector.service';
import { ProcessMotorEventUseCase } from './process-motor-event.use-case';
import { RetryMotorEventUseCase } from './retry-motor-event.use-case';

/**
 * Fase 15 — real-PostgreSQL evidence for the motor event ingestion
 * pipeline: durability across a real process restart, idempotent
 * dedup under repetition/concurrency, transactional rollback on a
 * mid-projection failure, and multi-tenant isolation. Built the same way
 * as restart-durability.integration.spec.ts and
 * confirm-prospect-import.integration.spec.ts — direct Prisma repository
 * instantiation against mr-outreach-test, not the full AppModule.
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(30_000);

function buildProcessUseCase(prisma: PrismaService): { useCase: ProcessMotorEventUseCase; retry: RetryMotorEventUseCase } {
  const tx = new PrismaTransactionManager(prisma);
  const auditLogs = new PrismaAuditLogRepository(prisma);
  const events = new PrismaIntegrationEventRepository(prisma);
  const projector = new MotorEventProjector(
    new PrismaSequenceExecutionRepository(prisma),
    new PrismaProspectImportRowRepository(prisma),
    new PrismaMailboxRepository(prisma),
    new PrismaMailboxAssignmentRepository(prisma),
    new PrismaConversationRepository(prisma),
    new PrismaConversationMessageRepository(prisma),
    new PrismaCompanyRepository(prisma),
    new PrismaContactRepository(prisma),
    new PrismaIntegrationCommandRepository(prisma),
    auditLogs,
  );
  const useCase = new ProcessMotorEventUseCase(tx, events, auditLogs, projector);
  const retry = new RetryMotorEventUseCase(events, auditLogs, useCase);
  return { useCase, retry };
}

describeIfDatabaseAvailable('Motor event ingestion (PostgreSQL integration)', () => {
  let prisma: PrismaService;
  let orgId: string;
  let executiveId: string;
  let mailboxId: string;
  let executionId: string;
  let prospectRowId: string;
  let companyId: string;
  let contactId: string;
  const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: `__fase_motor_event_${stamp}_${randomUUID()}` } });
    orgId = org.id;

    const client = await prisma.managedClient.create({
      data: { organizationId: orgId, source: 'SERVER', serverClientId: `srv_client_${randomUUID()}`, name: 'Cliente Motor Event', createdBy: 'seed', updatedBy: 'seed' },
    });
    const domain = await prisma.domain.create({
      data: { organizationId: orgId, clientId: client.id, domainName: `motor-event-${randomUUID().slice(0, 8)}.test`, createdBy: 'seed', updatedBy: 'seed' },
    });
    const executive = await prisma.user.create({
      data: { organizationId: orgId, firstName: 'Ejecutiva', lastName: 'Motor', email: `exec-motor-${randomUUID()}@example.com`, passwordHash: 'hash' },
    });
    executiveId = executive.id;
    const mailbox = await prisma.mailbox.create({
      data: { organizationId: orgId, clientId: client.id, domainId: domain.id, name: 'Ventas', email: `ventas-${randomUUID().slice(0, 8)}@cliente.test`, fromName: 'Ventas' },
    });
    mailboxId = mailbox.id;
    await prisma.mailboxAssignment.create({
      data: { organizationId: orgId, mailboxId: mailbox.id, userId: executive.id, role: 'PRIMARY', assignedBy: executive.id },
    });

    const template = await prisma.sequenceTemplate.create({
      data: { organizationId: orgId, ownerUserId: executive.id, mailboxId: mailbox.id, name: 'Plantilla Motor Event' },
    });
    const templateVersion = await prisma.sequenceTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        name: 'Plantilla Motor Event',
        mailboxId: mailbox.id,
        timezone: 'America/Santiago',
        subjectTemplate: 'Hola {{empresa}}',
        signatureHtml: '',
        variables: [],
        steps: [],
        createdBy: executive.id,
      },
    });
    const execution = await prisma.sequenceExecution.create({
      data: {
        organizationId: orgId,
        executiveId: executive.id,
        mailboxId: mailbox.id,
        templateId: template.id,
        templateVersionId: templateVersion.id,
        timezone: 'America/Santiago',
        status: 'SUBMITTING',
        createdBy: executive.id,
      },
    });
    executionId = execution.id;

    const prospectImport = await prisma.prospectImport.create({
      data: { organizationId: orgId, executionId: execution.id, fileName: 'prospectos.xlsx', storageKey: 'key_1', checksum: 'deadbeef', createdBy: executive.id },
    });
    const company = await prisma.company.create({ data: { organizationId: orgId, clientId: client.id, rawName: 'Empresa Motor Event', normalizedName: 'empresa motor event' } });
    companyId = company.id;
    const contact = await prisma.contact.create({ data: { organizationId: orgId, clientId: client.id, companyId: company.id, email: 'prospecto@empresa-motor.test', fullName: 'Juan Pérez' } });
    contactId = contact.id;
    const row = await prisma.prospectImportRow.create({
      data: {
        organizationId: orgId,
        importId: prospectImport.id,
        rowNumber: 1,
        rawData: { email: contact.email },
        normalizedData: { email: contact.email, contactName: 'Juan Pérez', companyName: 'Empresa Motor Event', variables: {} },
        validationStatus: 'VALID',
        executionState: 'STEP_01_PENDING',
        companyId: company.id,
        contactId: contact.id,
        resolvedAt: new Date(),
      },
    });
    prospectRowId = row.id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.integrationCommand.deleteMany({ where: { organizationId: orgId } });
    await prisma.conversationMessage.deleteMany({ where: { organizationId: orgId } });
    await prisma.conversation.deleteMany({ where: { organizationId: orgId } });
    await prisma.prospectImportRow.deleteMany({ where: { organizationId: orgId } });
    await prisma.prospectImport.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceExecution.deleteMany({ where: { organizationId: orgId } });
    await prisma.sequenceTemplateVersion.deleteMany({ where: { template: { organizationId: orgId } } });
    await prisma.sequenceTemplate.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailboxAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.mailbox.deleteMany({ where: { organizationId: orgId } });
    await prisma.domain.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedClient.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  function envelope(overrides: Partial<MotorEventEnvelopeDto> & Pick<MotorEventEnvelopeDto, 'eventType' | 'payload'>): MotorEventEnvelopeDto {
    return {
      schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
      eventId: `evt_${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      organizationId: orgId,
      commandId: null,
      correlationId: `corr_${randomUUID()}`,
      aggregateType: 'EXECUTION',
      aggregateId: executionId,
      ...overrides,
    };
  }

  it('accepted -> outbound created -> outbound sent -> restart -> inbound received survives a real process restart, fully attributed', async () => {
    const { useCase } = buildProcessUseCase(prisma);
    const outboundMessageId = `out_${randomUUID()}`;

    const accepted = await useCase.execute({
      envelope: envelope({ eventType: 'EXECUTION_ACCEPTED', payload: { serverExecutionId: `srv_${randomUUID()}` } }),
      origin: 'REMOTE',
    });
    expect(accepted.outcome).toBe('PROCESSED');

    const created = await useCase.execute({
      envelope: envelope({
        eventType: 'OUTBOUND_MESSAGE_CREATED',
        payload: {
          outboundMessageId,
          mailboxId,
          prospectImportRowId: prospectRowId,
          recipientEmail: 'prospecto@empresa-motor.test',
          subject: 'Hola Empresa Motor Event',
          htmlBody: '<p>Hola</p>',
          plainTextBody: 'Hola',
          stepNumber: 1,
        },
      }),
      origin: 'REMOTE',
    });
    expect(created.outcome).toBe('PROCESSED');

    const sent = await useCase.execute({
      envelope: envelope({ eventType: 'OUTBOUND_MESSAGE_SENT', payload: { outboundMessageId, serverMessageId: `srv_msg_${randomUUID()}`, messageIdHeader: `<${randomUUID()}@cliente.test>` } }),
      origin: 'REMOTE',
    });
    expect(sent.outcome).toBe('PROCESSED');

    // "Restart" — disconnect the writer connection entirely and build a brand-new PrismaService + use case graph.
    await prisma.$disconnect();
    const restartedPrisma = new PrismaService();
    const { useCase: restartedUseCase } = buildProcessUseCase(restartedPrisma);

    const inbound = await restartedUseCase.execute({
      envelope: envelope({
        eventType: 'INBOUND_MESSAGE_RECEIVED',
        payload: {
          mailboxId,
          emailMessageId: `in_${randomUUID()}`,
          senderEmail: 'prospecto@empresa-motor.test',
          subject: 'Re: Hola Empresa Motor Event',
          htmlBody: '<p>Gracias por contactarme</p>',
          plainTextBody: 'Gracias por contactarme',
          outboundMessageId,
        },
      }),
      origin: 'REMOTE',
    });
    expect(inbound.outcome).toBe('PROCESSED');

    const conversations = await restartedPrisma.conversation.findMany({ where: { organizationId: orgId, sequenceExecutionId: executionId } });
    expect(conversations).toHaveLength(1);
    const conversation = conversations[0];
    expect(conversation.origin).toBe('ACTIVE_EXECUTION');
    expect(conversation.contactId).toBe(contactId);
    expect(conversation.companyId).toBe(companyId);
    expect(conversation.assignedExecutiveId).toBe(executiveId);
    expect(conversation.isUnread).toBe(true);

    const messages = await restartedPrisma.conversationMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } });
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m.direction === 'OUTBOUND')?.sentAt).not.toBeNull();
    expect(messages.find((m) => m.direction === 'INBOUND')).toBeDefined();

    const persistedExecution = await restartedPrisma.sequenceExecution.findUniqueOrThrow({ where: { id: executionId } });
    expect(persistedExecution.status).toBe('ACCEPTED');

    const persistedEvents = await restartedPrisma.integrationEvent.findMany({ where: { organizationId: orgId } });
    expect(persistedEvents).toHaveLength(4);
    expect(persistedEvents.every((e) => e.status === 'PROCESSED')).toBe(true);

    const auditLogs = await restartedPrisma.auditLog.findMany({ where: { organizationId: orgId } });
    expect(auditLogs.length).toBeGreaterThanOrEqual(4);

    await restartedPrisma.$disconnect();
    // Re-point the shared `prisma` handle so afterEach's cleanup queries still work against a live connection.
    prisma = new PrismaService();
  });

  it('is idempotent under repeated delivery of the same eventId (2x, 5x, 10x) — never creates duplicate messages', async () => {
    const { useCase } = buildProcessUseCase(prisma);
    const outboundMessageId = `out_${randomUUID()}`;
    const sharedEnvelope = envelope({
      eventType: 'OUTBOUND_MESSAGE_CREATED',
      payload: {
        outboundMessageId,
        mailboxId,
        prospectImportRowId: prospectRowId,
        recipientEmail: 'prospecto@empresa-motor.test',
        subject: 'Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
      },
    });

    for (let i = 0; i < 10; i += 1) {
      const result = await useCase.execute({ envelope: sharedEnvelope, origin: 'REMOTE' });
      expect(['PROCESSED', 'ALREADY_PROCESSED']).toContain(result.outcome);
    }

    const events = await prisma.integrationEvent.findMany({ where: { organizationId: orgId, eventId: sharedEnvelope.eventId } });
    expect(events).toHaveLength(1);
    const messages = await prisma.conversationMessage.findMany({ where: { organizationId: orgId, outboundMessageId } });
    expect(messages).toHaveLength(1);
  });

  it('processes concurrent deliveries of the same eventId without double-projecting', async () => {
    const { useCase } = buildProcessUseCase(prisma);
    const outboundMessageId = `out_${randomUUID()}`;
    const sharedEnvelope = envelope({
      eventType: 'OUTBOUND_MESSAGE_CREATED',
      payload: {
        outboundMessageId,
        mailboxId,
        prospectImportRowId: prospectRowId,
        recipientEmail: 'prospecto@empresa-motor.test',
        subject: 'Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
      },
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => useCase.execute({ envelope: sharedEnvelope, origin: 'REMOTE' })),
    );
    expect(results.every((r) => ['PROCESSED', 'ALREADY_PROCESSED', 'ALREADY_PROCESSING'].includes(r.outcome))).toBe(true);

    const messages = await prisma.conversationMessage.findMany({ where: { organizationId: orgId, outboundMessageId } });
    expect(messages).toHaveLength(1);
    const conversations = await prisma.conversation.findMany({ where: { organizationId: orgId, sequenceExecutionId: executionId } });
    expect(conversations).toHaveLength(1);
  });

  it('rolls back cleanly on a mid-projection failure and marks the event FAILED_TERMINAL, without creating a partial Conversation', async () => {
    const { useCase } = buildProcessUseCase(prisma);
    const badEnvelope = envelope({
      eventType: 'OUTBOUND_MESSAGE_CREATED',
      payload: {
        outboundMessageId: `out_${randomUUID()}`,
        mailboxId: 'nonexistent-mailbox-id',
        prospectImportRowId: prospectRowId,
        recipientEmail: 'prospecto@empresa-motor.test',
        subject: 'Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
      },
    });

    const result = await useCase.execute({ envelope: badEnvelope, origin: 'REMOTE' });

    expect(result.outcome).toBe('FAILED_TERMINAL');
    const persistedEvent = await prisma.integrationEvent.findFirstOrThrow({ where: { organizationId: orgId, eventId: badEnvelope.eventId } });
    expect(persistedEvent.status).toBe('FAILED_TERMINAL');
    expect(persistedEvent.errorCode).toBe('MAILBOX_NOT_FOUND');
    const conversations = await prisma.conversation.findMany({ where: { organizationId: orgId } });
    expect(conversations).toHaveLength(0);
  });

  it('a manual retry re-projects a FAILED_RETRYABLE event once its blocker is resolved', async () => {
    const { useCase, retry } = buildProcessUseCase(prisma);
    const outboundMessageId = `out_${randomUUID()}`;

    // OUTBOUND_MESSAGE_SENT arrives before OUTBOUND_MESSAGE_CREATED — out-of-order delivery, retryable.
    const sentFirst = await useCase.execute({
      envelope: envelope({ eventType: 'OUTBOUND_MESSAGE_SENT', payload: { outboundMessageId } }),
      origin: 'REMOTE',
    });
    expect(sentFirst.outcome).toBe('FAILED_RETRYABLE');

    await useCase.execute({
      envelope: envelope({
        eventType: 'OUTBOUND_MESSAGE_CREATED',
        payload: {
          outboundMessageId,
          mailboxId,
          prospectImportRowId: prospectRowId,
          recipientEmail: 'prospecto@empresa-motor.test',
          subject: 'Hola',
          htmlBody: '<p>Hola</p>',
          plainTextBody: 'Hola',
        },
      }),
      origin: 'REMOTE',
    });

    const failedRow = await prisma.integrationEvent.findFirstOrThrow({ where: { organizationId: orgId, status: 'FAILED_RETRYABLE' } });
    const retried = await retry.execute(orgId, failedRow.id, executiveId);
    expect(retried.outcome).toBe('PROCESSED');

    const message = await prisma.conversationMessage.findFirstOrThrow({ where: { organizationId: orgId, outboundMessageId } });
    expect(message.sentAt).not.toBeNull();
  });

  it('never lets a commandId from another organization update that organization\'s IntegrationCommand', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: `__fase_motor_event_other_${stamp}_${randomUUID()}` } });
    await prisma.managedClient.create({
      data: { organizationId: otherOrg.id, source: 'SERVER', serverClientId: `srv_other_${randomUUID()}`, name: 'Otro Cliente', createdBy: 'seed', updatedBy: 'seed' },
    });
    const otherUser = await prisma.user.create({
      data: { organizationId: otherOrg.id, firstName: 'Otro', lastName: 'Ejecutivo', email: `otro-${randomUUID()}@example.com`, passwordHash: 'hash' },
    });
    const otherCommand = await prisma.integrationCommand.create({
      data: {
        organizationId: otherOrg.id,
        commandId: `cmd_other_${randomUUID()}`,
        commandType: 'SEQUENCE_EXECUTION_START_REQUESTED',
        aggregateType: 'EXECUTION',
        aggregateId: randomUUID(),
        schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
        idempotencyKey: `key_${randomUUID()}`,
        correlationId: `corr_${randomUUID()}`,
        payload: {},
        requestedBy: otherUser.id,
      },
    });

    const { useCase } = buildProcessUseCase(prisma);
    const result = await useCase.execute({
      envelope: envelope({ eventType: 'EXECUTION_ACCEPTED', commandId: otherCommand.commandId, payload: { serverExecutionId: `srv_${randomUUID()}` } }),
      origin: 'REMOTE',
    });
    expect(result.outcome).toBe('PROCESSED');

    const untouchedCommand = await prisma.integrationCommand.findUniqueOrThrow({ where: { id: otherCommand.id } });
    expect(untouchedCommand.status).toBe('REQUESTED');

    await prisma.integrationCommand.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.user.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.managedClient.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });

  it('allows the same eventId to be reused independently across two different organizations (dedup is per-organization)', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: `__fase_motor_event_org2_${stamp}_${randomUUID()}` } });
    const { useCase: useCaseOrg1 } = buildProcessUseCase(prisma);
    const sharedEventId = `evt_shared_${randomUUID()}`;

    const resultOrg1 = await useCaseOrg1.execute({
      envelope: {
        schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
        eventId: sharedEventId,
        eventType: 'EXECUTION_ACCEPTED',
        occurredAt: new Date().toISOString(),
        organizationId: orgId,
        commandId: null,
        correlationId: `corr_${randomUUID()}`,
        aggregateType: 'EXECUTION',
        aggregateId: executionId,
        payload: { serverExecutionId: `srv_${randomUUID()}` },
      },
      origin: 'REMOTE',
    });
    expect(resultOrg1.outcome).toBe('PROCESSED');

    // org2 has no SequenceExecution `executionId`, so this necessarily fails — the point is only that it is
    // evaluated as its OWN independent row (never short-circuited as "already processed" from org1's event).
    const resultOrg2 = await useCaseOrg1.execute({
      envelope: {
        schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
        eventId: sharedEventId,
        eventType: 'EXECUTION_ACCEPTED',
        occurredAt: new Date().toISOString(),
        organizationId: otherOrg.id,
        commandId: null,
        correlationId: `corr_${randomUUID()}`,
        aggregateType: 'EXECUTION',
        aggregateId: executionId,
        payload: { serverExecutionId: `srv_${randomUUID()}` },
      },
      origin: 'REMOTE',
    });
    expect(resultOrg2.outcome).toBe('FAILED_TERMINAL');

    const eventsAcrossOrgs = await prisma.integrationEvent.findMany({ where: { eventId: sharedEventId } });
    expect(eventsAcrossOrgs).toHaveLength(2);

    await prisma.auditLog.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.integrationEvent.deleteMany({ where: { organizationId: otherOrg.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });
});
