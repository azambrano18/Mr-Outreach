import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Company } from '../../domain/company/company.entity';
import { CompanyRepository } from '../../domain/company/company.repository';
import { Contact } from '../../domain/contact/contact.entity';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { Conversation } from '../../domain/conversation/conversation.entity';
import { ConversationMessage } from '../../domain/conversation/conversation-message.entity';
import { ConversationMessageRepository } from '../../domain/conversation/conversation-message.repository';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { IntegrationCommand } from '../../domain/integration/integration-command.entity';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext } from '../../domain/persistence/transaction';
import { ProspectImportRow } from '../../domain/prospect-import/prospect-import-row.entity';
import { ProspectImportRowRepository } from '../../domain/prospect-import/prospect-import-row.repository';
import { SequenceExecution } from '../../domain/sequence-execution/sequence-execution.entity';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import { MotorEventProjectionError, MotorEventProjector } from './motor-event-projector.service';

const ctx: TransactionContext = { kind: 'fake' };
const orgId = 'org_1';

describe('MotorEventProjector', () => {
  let executions: jest.Mocked<SequenceExecutionRepository>;
  let prospectRows: jest.Mocked<ProspectImportRowRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let conversations: jest.Mocked<ConversationRepository>;
  let messages: jest.Mocked<ConversationMessageRepository>;
  let companies: jest.Mocked<CompanyRepository>;
  let contacts: jest.Mocked<ContactRepository>;
  let commands: jest.Mocked<IntegrationCommandRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let projector: MotorEventProjector;

  function buildEvent(overrides: Partial<IntegrationEvent> = {}): IntegrationEvent {
    return {
      id: 'evtrow_1',
      organizationId: orgId,
      eventId: 'evt_1',
      eventType: 'EXECUTION_ACCEPTED',
      commandId: null,
      correlationId: 'corr_1',
      schemaVersion: '1.0',
      aggregateType: 'EXECUTION',
      aggregateId: 'exec_1',
      payload: {},
      status: 'PROCESSING',
      origin: 'REMOTE',
      occurredAt: new Date('2026-07-31T12:00:00.000Z'),
      receivedAt: new Date(),
      processedAt: null,
      processingError: null,
      errorCode: null,
      failedAt: null,
      attempts: 0,
      ...overrides,
    };
  }

  const execution: SequenceExecution = {
    id: 'exec_1',
    organizationId: orgId,
    executiveId: 'user_exec',
    mailboxId: 'mailbox_1',
    templateId: 'template_1',
    templateVersionId: 'template_version_1',
    name: 'Gestión_31072026',
    timezone: 'America/Santiago',
    status: 'ACCEPTED',
    prospectImportId: 'import_1',
    requestedAt: new Date(),
    receivedAt: new Date(),
    estimatedStartAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    serverStatus: null,
    currentStepNumber: null,
    sentCount: null,
    pendingCount: null,
    failedCount: null,
    receivedProspects: null,
    acceptedProspects: null,
    rejectedProspects: null,
    initialProspectState: null,
    lastSyncedAt: null,
    lastError: null,
    serverExecutionId: 'srv_exec_1',
    executionTokenCiphertext: null,
    lastSubmissionIdempotencyKey: null,
    pausedAt: null,
    resumedAt: null,
    stoppedAt: null,
    stopReason: null,
    lastControlIdempotencyKey: null,
    executionAttempt: 1,
    previousExecutionId: null,
    createdBy: 'user_exec',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mailbox: Mailbox = {
    id: 'mailbox_1',
    organizationId: orgId,
    clientId: 'client_1',
    domainId: 'domain_1',
    name: 'Ventas',
    email: 'ventas@cliente.test',
    fromName: 'Ventas',
    replyTo: null,
    status: 'ACTIVE',
    connectionStatus: 'CONNECTED',
    provisioningStatus: 'PROVISIONED',
    timezone: 'America/Santiago',
    sendingLimits: { dailyLimit: 100, minimumIntervalSeconds: 30, maximumIntervalSeconds: 90 },
    lastProvisionCommandId: null,
    lastTestedAt: null,
    lastTestedBy: null,
    lastTestMessage: null,
    imap: null,
    smtp: null,
    linkSource: 'SERVER_TOKEN',
    linkStatus: 'ACTIVE',
    serverMailboxId: 'srv_mbx_1',
    serverDomainId: 'srv_dom_1',
    serverClientId: 'srv_client_1',
    serverRedemptionId: 'red_1',
    tokenFingerprint: 'fp_1',
    emailSnapshot: 'ventas@cliente.test',
    domainSnapshot: 'cliente.test',
    clientNameSnapshot: 'Cliente Uno',
    serverStatusSnapshot: 'CONNECTED',
    serverCanSendSnapshot: true,
    serverStatusCheckedAt: null,
    linkedAt: new Date(),
    linkedBy: 'admin_1',
    unlinkRequestedAt: null,
    unlinkRequestedBy: null,
    unlinkReason: null,
    revokedAt: null,
    revocationId: null,
    lastLinkCommandId: null,
    assetCleanupStatus: 'NOT_NEEDED',
    assetCleanupAttempts: 0,
    lastAssetCleanupError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  function buildRow(overrides: Partial<ProspectImportRow> = {}): ProspectImportRow {
    return {
      id: 'row_1',
      organizationId: orgId,
      importId: 'import_1',
      rowNumber: 1,
      rawData: { email: 'prospecto@empresa.test' },
      normalizedData: { email: 'prospecto@empresa.test', contactName: 'Juan Pérez', companyName: 'Empresa SA', variables: {} },
      validationStatus: 'VALID',
      validationErrors: [],
      executionState: 'STEP_01_PENDING',
      companyId: 'company_1',
      contactId: 'contact_1',
      resolvedAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    };
  }

  const contact: Contact = {
    id: 'contact_1',
    organizationId: orgId,
    clientId: 'client_1',
    companyId: 'company_1',
    email: 'prospecto@empresa.test',
    firstName: 'Juan',
    lastName: 'Pérez',
    fullName: 'Juan Pérez',
    jobTitle: null,
    phone: null,
    city: null,
    country: null,
    website: null,
    linkedin: null,
    customFields: {},
    suppressed: false,
    suppressedAt: null,
    suppressedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const company: Company = {
    id: 'company_1',
    organizationId: orgId,
    clientId: 'client_1',
    rawName: 'Empresa SA',
    normalizedName: 'empresa sa',
    suppressed: false,
    suppressedAt: null,
    suppressedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  function buildConversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
      id: 'conv_1',
      organizationId: orgId,
      clientId: 'client_1',
      domainId: 'domain_1',
      mailboxId: 'mailbox_1',
      emailThreadId: 'out_1',
      contactEmail: 'prospecto@empresa.test',
      contactName: 'Juan Pérez',
      companyNameSnapshot: 'Empresa SA',
      contactId: 'contact_1',
      companyId: 'company_1',
      origin: 'ACTIVE_EXECUTION',
      sequenceContactId: null,
      originatingScheduledEmailId: null,
      sequenceId: null,
      sequenceStepId: null,
      sequenceExecutionId: 'exec_1',
      prospectImportRowId: 'row_1',
      assignedExecutiveId: 'user_exec',
      subject: 'Hola',
      managementStatus: 'NEW',
      classification: 'UNCLASSIFIED',
      responseOutcome: null,
      isUnread: false,
      lastMessageAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
      archivedAt: null,
      isSimulation: false,
      simulationBatchId: null,
      simulationScenario: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };
  }

  function buildMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
    return {
      id: 'msg_1',
      organizationId: orgId,
      conversationId: 'conv_1',
      mailboxId: 'mailbox_1',
      emailMessageId: 'out_1',
      direction: 'OUTBOUND',
      serverMessageId: null,
      outboundMessageId: 'out_1',
      messageIdHeader: null,
      inReplyTo: null,
      references: null,
      senderEmail: 'ventas@cliente.test',
      senderName: 'Ventas',
      recipients: ['prospecto@empresa.test'],
      cc: [],
      bcc: [],
      subject: 'Hola',
      htmlBody: '<p>Hola</p>',
      plainTextBody: 'Hola',
      stepNumber: 1,
      receivedAt: null,
      sentAt: null,
      messageType: 'OUTREACH_EMAIL',
      createdAt: new Date(),
      ...overrides,
    };
  }

  function buildCommand(overrides: Partial<IntegrationCommand> = {}): IntegrationCommand {
    return {
      id: 'cmdrow_1',
      organizationId: orgId,
      commandId: 'cmd_1',
      commandType: 'SEQUENCE_EXECUTION_START' as never,
      aggregateType: 'EXECUTION',
      aggregateId: 'exec_1',
      schemaVersion: '1.0',
      idempotencyKey: 'key_1',
      correlationId: 'corr_1',
      payload: {},
      status: 'REQUESTED',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      requestedBy: 'user_exec',
      createdAt: new Date(),
      sentAt: null,
      acceptedAt: null,
      completedAt: null,
      payloadHash: null,
      resultSnapshot: null,
      httpStatusCode: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    executions = {
      findById: jest.fn().mockResolvedValue(execution),
      findByServerExecutionId: jest.fn().mockResolvedValue(execution),
      findByExecutive: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockImplementation((_id, input) => Promise.resolve({ ...execution, ...input })),
      delete: jest.fn(),
      conditionalUpdateStatus: jest.fn(),
      conditionalUpdateStatusFromAllowed: jest.fn(),
    };
    prospectRows = {
      findById: jest.fn().mockResolvedValue(buildRow()),
      findByImport: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    } as unknown as jest.Mocked<ProspectImportRowRepository>;
    mailboxes = {
      findById: jest.fn().mockResolvedValue(mailbox),
      findByIdIncludingDeleted: jest.fn(),
      findByEmail: jest.fn(),
      findByServerMailboxId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      createLinked: jest.fn(),
      update: jest.fn(),
    };
    assignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByMailbox: jest.fn().mockResolvedValue([{ id: 'assign_1', organizationId: orgId, mailboxId: 'mailbox_1', userId: 'user_exec', role: 'PRIMARY', assignedBy: 'admin_1', assignedAt: new Date() }]),
      findByUser: jest.fn(),
      findAllByOrganization: jest.fn(),
    };
    conversations = {
      findById: jest.fn(),
      findByMailboxAndThread: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((input) => Promise.resolve(buildConversation(input as Partial<Conversation>))),
      update: jest.fn().mockImplementation((id, input) => Promise.resolve({ ...buildConversation(), id, ...input })),
      addTag: jest.fn(),
      removeTag: jest.fn(),
      listTagIds: jest.fn(),
      delete: jest.fn(),
    };
    messages = {
      findByConversation: jest.fn(),
      findByEmailMessageId: jest.fn().mockResolvedValue(null),
      findByMessageIdHeader: jest.fn().mockResolvedValue(null),
      findByOutboundMessageId: jest.fn().mockResolvedValue(null),
      findLastInboundForConversations: jest.fn().mockResolvedValue(new Map()),
      create: jest.fn().mockImplementation((input) => Promise.resolve(buildMessage(input as Partial<ConversationMessage>))),
      update: jest.fn().mockImplementation((id, input) => Promise.resolve({ ...buildMessage(), id, ...input })),
      deleteByConversation: jest.fn(),
    };
    companies = {
      findById: jest.fn().mockResolvedValue(company),
      findByNormalizedName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<CompanyRepository>;
    contacts = {
      findById: jest.fn().mockResolvedValue(contact),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<ContactRepository>;
    commands = {
      findById: jest.fn(),
      findByCommandId: jest.fn().mockResolvedValue(null),
      findByIdempotencyKey: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockImplementation((id, input) => Promise.resolve({ ...buildCommand(), id, ...input })),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };

    projector = new MotorEventProjector(
      executions,
      prospectRows,
      mailboxes,
      assignments,
      conversations,
      messages,
      companies,
      contacts,
      commands,
      auditLogs,
    );
  });

  describe('EXECUTION_ACCEPTED / EXECUTION_PROCESSING / EXECUTION_COMPLETED', () => {
    it('updates the SequenceExecution to ACCEPTED and stores the serverExecutionId', async () => {
      const event = buildEvent({ eventType: 'EXECUTION_ACCEPTED', payload: { serverExecutionId: 'srv_exec_new' } });

      await projector.project(event, ctx);

      expect(executions.update).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({ status: 'ACCEPTED', serverExecutionId: 'srv_exec_new' }),
        ctx,
      );
      expect(auditLogs.record).toHaveBeenCalled();
    });

    it('moves the execution to RUNNING on EXECUTION_PROCESSING', async () => {
      await projector.project(buildEvent({ eventType: 'EXECUTION_PROCESSING' }), ctx);
      expect(executions.update).toHaveBeenCalledWith('exec_1', expect.objectContaining({ status: 'RUNNING' }), ctx);
    });

    it('moves the execution to COMPLETED and stamps completedAt on EXECUTION_COMPLETED', async () => {
      await projector.project(buildEvent({ eventType: 'EXECUTION_COMPLETED' }), ctx);
      expect(executions.update).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) }),
        ctx,
      );
    });

    it('throws a non-retryable error when the SequenceExecution does not exist', async () => {
      executions.findById.mockResolvedValue(null);
      await expect(projector.project(buildEvent({ eventType: 'EXECUTION_ACCEPTED' }), ctx)).rejects.toMatchObject({
        retryable: false,
        errorCode: 'EXECUTION_NOT_FOUND',
      });
    });

    it('throws a non-retryable error when the SequenceExecution belongs to another organization', async () => {
      executions.findById.mockResolvedValue({ ...execution, organizationId: 'org_other' });
      await expect(projector.project(buildEvent({ eventType: 'EXECUTION_ACCEPTED' }), ctx)).rejects.toBeInstanceOf(MotorEventProjectionError);
    });
  });

  describe('EXECUTION_FAILED', () => {
    it('marks the execution FAILED with the reported error, and never touches Conversation/ConversationMessage', async () => {
      const event = buildEvent({ eventType: 'EXECUTION_FAILED', payload: { errorMessage: 'El motor no pudo continuar.' } });

      await projector.project(event, ctx);

      expect(executions.update).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({ status: 'FAILED', lastError: 'El motor no pudo continuar.' }),
        ctx,
      );
      expect(conversations.create).not.toHaveBeenCalled();
      expect(conversations.update).not.toHaveBeenCalled();
      expect(messages.create).not.toHaveBeenCalled();
    });
  });

  describe('Fase "Control operativo de Gestiones" — EXECUTION_PAUSE/RESUME/STOP', () => {
    it('EXECUTION_PAUSE_ACCEPTED is purely informational — never touches the execution row', async () => {
      const event = buildEvent({ eventType: 'EXECUTION_PAUSE_ACCEPTED', commandId: 'cmd_1' });
      await projector.project(event, ctx);
      expect(executions.update).not.toHaveBeenCalled();
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence_execution.motor_event.execution_pause_accepted', entityId: 'exec_1' }),
        ctx,
      );
    });

    it('EXECUTION_PAUSED moves the execution to PAUSED and stamps pausedAt', async () => {
      const event = buildEvent({ eventType: 'EXECUTION_PAUSED' });
      await projector.project(event, ctx);
      expect(executions.update).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({ status: 'PAUSED', pausedAt: expect.any(Date) }),
        ctx,
      );
    });

    it('EXECUTION_PAUSED is idempotent — a re-projection never overwrites an already-set pausedAt', async () => {
      const alreadyPausedAt = new Date('2026-08-01T10:00:00.000Z');
      executions.findById.mockResolvedValue({ ...execution, status: 'PAUSED', pausedAt: alreadyPausedAt });
      await projector.project(buildEvent({ eventType: 'EXECUTION_PAUSED' }), ctx);
      expect(executions.update).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({ status: 'PAUSED', pausedAt: alreadyPausedAt }),
        ctx,
      );
    });

    it('EXECUTION_RESUME_ACCEPTED is purely informational — never touches the execution row', async () => {
      await projector.project(buildEvent({ eventType: 'EXECUTION_RESUME_ACCEPTED' }), ctx);
      expect(executions.update).not.toHaveBeenCalled();
    });

    it('EXECUTION_RESUMED moves the execution back to RUNNING and stamps resumedAt', async () => {
      await projector.project(buildEvent({ eventType: 'EXECUTION_RESUMED' }), ctx);
      expect(executions.update).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({ status: 'RUNNING', resumedAt: expect.any(Date) }),
        ctx,
      );
    });

    it('EXECUTION_STOP_ACCEPTED is purely informational — never touches the execution row', async () => {
      await projector.project(buildEvent({ eventType: 'EXECUTION_STOP_ACCEPTED' }), ctx);
      expect(executions.update).not.toHaveBeenCalled();
    });

    it('EXECUTION_STOPPED moves the execution to STOPPED and stamps stoppedAt', async () => {
      await projector.project(buildEvent({ eventType: 'EXECUTION_STOPPED', payload: { reason: 'Cliente solicitó detener la campaña.' } }), ctx);
      expect(executions.update).toHaveBeenCalledWith(
        'exec_1',
        expect.objectContaining({ status: 'STOPPED', stoppedAt: expect.any(Date) }),
        ctx,
      );
    });

    it('every control event links its IntegrationCommand and never touches Conversation/ConversationMessage', async () => {
      const event = buildEvent({ eventType: 'EXECUTION_STOPPED', commandId: 'cmd_1' });
      commands.findByCommandId.mockResolvedValue({ ...buildCommand(), id: 'cmdrow_1', commandId: 'cmd_1' });
      await projector.project(event, ctx);
      expect(commands.update).toHaveBeenCalledWith('cmdrow_1', expect.objectContaining({ status: 'COMPLETED' }), ctx);
      expect(conversations.create).not.toHaveBeenCalled();
      expect(messages.create).not.toHaveBeenCalled();
    });

    it('throws a non-retryable error when the SequenceExecution does not exist', async () => {
      executions.findById.mockResolvedValue(null);
      await expect(projector.project(buildEvent({ eventType: 'EXECUTION_PAUSED' }), ctx)).rejects.toMatchObject({
        retryable: false,
        errorCode: 'EXECUTION_NOT_FOUND',
      });
    });
  });

  describe('OUTBOUND_MESSAGE_CREATED', () => {
    function outboundPayload(overrides: Record<string, unknown> = {}) {
      return {
        outboundMessageId: 'out_1',
        mailboxId: 'mailbox_1',
        prospectImportRowId: 'row_1',
        recipientEmail: 'prospecto@empresa.test',
        subject: 'Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
        stepNumber: 1,
        ...overrides,
      };
    }

    it('creates a new ACTIVE_EXECUTION conversation and an OUTBOUND message for a known contact/company', async () => {
      const event = buildEvent({ eventType: 'OUTBOUND_MESSAGE_CREATED', payload: outboundPayload() });

      await projector.project(event, ctx);

      expect(conversations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: 'ACTIVE_EXECUTION',
          contactId: 'contact_1',
          companyId: 'company_1',
          sequenceExecutionId: 'exec_1',
          prospectImportRowId: 'row_1',
          mailboxId: 'mailbox_1',
        }),
        ctx,
      );
      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'OUTBOUND', outboundMessageId: 'out_1', stepNumber: 1 }),
        ctx,
      );
    });

    it('falls back to the row-normalized email when the row has no resolved Contact yet (unknown contact)', async () => {
      prospectRows.findById.mockResolvedValue(buildRow({ contactId: null, companyId: null }));
      contacts.findById.mockResolvedValue(null);
      companies.findById.mockResolvedValue(null);
      const event = buildEvent({ eventType: 'OUTBOUND_MESSAGE_CREATED', payload: outboundPayload() });

      await projector.project(event, ctx);

      expect(conversations.create).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: null, companyId: null, contactEmail: 'prospecto@empresa.test' }),
        ctx,
      );
    });

    it('reuses an existing conversation for the same mailbox+thread instead of creating a second one', async () => {
      conversations.findByMailboxAndThread.mockResolvedValue(buildConversation());
      const event = buildEvent({ eventType: 'OUTBOUND_MESSAGE_CREATED', payload: outboundPayload() });

      await projector.project(event, ctx);

      expect(conversations.create).not.toHaveBeenCalled();
      expect(messages.create).toHaveBeenCalled();
    });

    it('never creates a duplicate OUTBOUND message for the same outboundMessageId', async () => {
      messages.findByOutboundMessageId.mockResolvedValue(buildMessage());
      const event = buildEvent({ eventType: 'OUTBOUND_MESSAGE_CREATED', payload: outboundPayload() });

      await projector.project(event, ctx);

      expect(messages.create).not.toHaveBeenCalled();
    });

    it('throws a non-retryable error when the mailbox does not exist or belongs to another organization', async () => {
      mailboxes.findById.mockResolvedValue(null);
      const event = buildEvent({ eventType: 'OUTBOUND_MESSAGE_CREATED', payload: outboundPayload() });

      await expect(projector.project(event, ctx)).rejects.toMatchObject({ retryable: false, errorCode: 'MAILBOX_NOT_FOUND' });
    });

    it('throws a non-retryable error when the ProspectImportRow does not exist or belongs to another organization', async () => {
      prospectRows.findById.mockResolvedValue(null);
      const event = buildEvent({ eventType: 'OUTBOUND_MESSAGE_CREATED', payload: outboundPayload() });

      await expect(projector.project(event, ctx)).rejects.toMatchObject({ retryable: false, errorCode: 'PROSPECT_ROW_NOT_FOUND' });
    });
  });

  describe('OUTBOUND_MESSAGE_SENT', () => {
    it('updates the existing OUTBOUND message with sentAt/serverMessageId/messageIdHeader', async () => {
      messages.findByOutboundMessageId.mockResolvedValue(buildMessage());
      const event = buildEvent({
        eventType: 'OUTBOUND_MESSAGE_SENT',
        payload: { outboundMessageId: 'out_1', serverMessageId: 'srv_msg_1', messageIdHeader: '<abc@cliente.test>' },
      });

      await projector.project(event, ctx);

      expect(messages.update).toHaveBeenCalledWith(
        'msg_1',
        expect.objectContaining({ serverMessageId: 'srv_msg_1', messageIdHeader: '<abc@cliente.test>', sentAt: expect.any(Date) }),
        ctx,
      );
    });

    it('throws a retryable error when OUTBOUND_MESSAGE_CREATED has not landed yet (out-of-order delivery)', async () => {
      messages.findByOutboundMessageId.mockResolvedValue(null);
      const event = buildEvent({ eventType: 'OUTBOUND_MESSAGE_SENT', payload: { outboundMessageId: 'out_missing' } });

      await expect(projector.project(event, ctx)).rejects.toMatchObject({ retryable: true, errorCode: 'OUTBOUND_MESSAGE_NOT_FOUND' });
    });
  });

  describe('INBOUND_MESSAGE_RECEIVED — conversation resolution priority', () => {
    function inboundPayload(overrides: Record<string, unknown> = {}) {
      return {
        mailboxId: 'mailbox_1',
        emailMessageId: 'in_1',
        senderEmail: 'prospecto@empresa.test',
        subject: 'Re: Hola',
        htmlBody: '<p>Gracias</p>',
        plainTextBody: 'Gracias',
        ...overrides,
      };
    }

    it('priority 1 — resolves via In-Reply-To over every other signal', async () => {
      messages.findByMessageIdHeader.mockResolvedValue(buildMessage({ conversationId: 'conv_by_in_reply_to' }));
      const event = buildEvent({
        eventType: 'INBOUND_MESSAGE_RECEIVED',
        payload: inboundPayload({ inReplyTo: '<out1@cliente.test>', outboundMessageId: 'out_should_be_ignored' }),
      });

      await projector.project(event, ctx);

      expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_by_in_reply_to' }), ctx);
      expect(messages.findByOutboundMessageId).not.toHaveBeenCalled();
    });

    it('priority 2 — falls back to References (tried in reverse order) when In-Reply-To does not resolve', async () => {
      messages.findByMessageIdHeader.mockImplementation((_org, headerId) =>
        Promise.resolve(headerId === '<ref2@cliente.test>' ? buildMessage({ conversationId: 'conv_by_references' }) : null),
      );
      const event = buildEvent({
        eventType: 'INBOUND_MESSAGE_RECEIVED',
        payload: inboundPayload({ references: '<ref1@cliente.test> <ref2@cliente.test>' }),
      });

      await projector.project(event, ctx);

      expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_by_references' }), ctx);
    });

    it('priority 3 — falls back to outboundMessageId when no header-based match exists', async () => {
      messages.findByOutboundMessageId.mockResolvedValue(buildMessage({ conversationId: 'conv_by_outbound_id' }));
      const event = buildEvent({ eventType: 'INBOUND_MESSAGE_RECEIVED', payload: inboundPayload({ outboundMessageId: 'out_1' }) });

      await projector.project(event, ctx);

      expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_by_outbound_id' }), ctx);
    });

    it('priority 4 — falls back to serverExecutionId+prospectImportRowId', async () => {
      conversations.findByMailboxAndThread.mockResolvedValue(buildConversation({ id: 'conv_by_exec_and_row' }));
      const event = buildEvent({
        eventType: 'INBOUND_MESSAGE_RECEIVED',
        payload: inboundPayload({ serverExecutionId: 'srv_exec_1', prospectImportRowId: 'row_1' }),
      });

      await projector.project(event, ctx);

      expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_by_exec_and_row' }), ctx);
    });

    it('priority 5 (last resort) — falls back to mailbox + normalized sender email', async () => {
      conversations.findAll.mockResolvedValue([buildConversation({ id: 'conv_by_mailbox_and_email' })]);
      const event = buildEvent({ eventType: 'INBOUND_MESSAGE_RECEIVED', payload: inboundPayload({ senderEmail: 'PROSPECTO@empresa.test' }) });

      await projector.project(event, ctx);

      expect(conversations.findAll).toHaveBeenCalledWith(orgId, { mailboxId: 'mailbox_1', contactEmail: 'prospecto@empresa.test' });
      expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_by_mailbox_and_email' }), ctx);
    });

    it('creates a new EXTERNAL_INBOUND conversation, never rejecting the event, when nothing resolves (unknown contact)', async () => {
      const event = buildEvent({ eventType: 'INBOUND_MESSAGE_RECEIVED', payload: inboundPayload({ senderEmail: 'desconocido@otra.test' }) });

      await projector.project(event, ctx);

      expect(conversations.create).toHaveBeenCalledWith(expect.objectContaining({ origin: 'EXTERNAL_INBOUND', assignedExecutiveId: null }), ctx);
      expect(messages.create).toHaveBeenCalled();
    });

    it('marks the resolved conversation unread and bumps lastMessageAt', async () => {
      messages.findByOutboundMessageId.mockResolvedValue(buildMessage({ conversationId: 'conv_1' }));
      const event = buildEvent({ eventType: 'INBOUND_MESSAGE_RECEIVED', payload: inboundPayload({ outboundMessageId: 'out_1' }) });

      await projector.project(event, ctx);

      expect(conversations.update).toHaveBeenCalledWith('conv_1', expect.objectContaining({ isUnread: true }), ctx);
    });

    it('never creates a duplicate INBOUND message for the same emailMessageId within a conversation', async () => {
      messages.findByOutboundMessageId.mockResolvedValue(buildMessage({ conversationId: 'conv_1' }));
      messages.findByEmailMessageId.mockResolvedValue(buildMessage({ direction: 'INBOUND' }));
      const event = buildEvent({ eventType: 'INBOUND_MESSAGE_RECEIVED', payload: inboundPayload({ outboundMessageId: 'out_1' }) });

      await projector.project(event, ctx);

      expect(messages.create).not.toHaveBeenCalled();
    });

    it('throws a non-retryable error when the mailbox does not exist or belongs to another organization', async () => {
      mailboxes.findById.mockResolvedValue(null);
      const event = buildEvent({ eventType: 'INBOUND_MESSAGE_RECEIVED', payload: inboundPayload() });

      await expect(projector.project(event, ctx)).rejects.toMatchObject({ retryable: false, errorCode: 'MAILBOX_NOT_FOUND' });
    });
  });

  describe('FUTURE_JOBS_CANCELLED', () => {
    it('only records an audit entry, never touching Conversation/ConversationMessage/Contact/Company', async () => {
      const event = buildEvent({ eventType: 'FUTURE_JOBS_CANCELLED', payload: { contactId: 'contact_1', reason: 'company_replied_not_interested' } });

      await projector.project(event, ctx);

      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sequence_execution.motor_event.future_jobs_cancelled' }),
        ctx,
      );
      expect(conversations.create).not.toHaveBeenCalled();
      expect(conversations.update).not.toHaveBeenCalled();
      expect(messages.create).not.toHaveBeenCalled();
      expect(contacts.update).not.toHaveBeenCalled();
      expect(companies.update).not.toHaveBeenCalled();
    });
  });

  describe('IntegrationCommand linkage (Fase 10)', () => {
    it('updates the linked command to the mapped status when it belongs to the same organization and aggregate', async () => {
      commands.findByCommandId.mockResolvedValue(buildCommand());
      const event = buildEvent({ eventType: 'EXECUTION_ACCEPTED', commandId: 'cmd_1', payload: { serverExecutionId: 'srv_1' } });

      await projector.project(event, ctx);

      expect(commands.findByCommandId).toHaveBeenCalledWith(orgId, 'cmd_1');
      expect(commands.update).toHaveBeenCalledWith('cmdrow_1', expect.objectContaining({ status: 'ACCEPTED' }), ctx);
    });

    it('never updates another organization\'s command — findByCommandId is scoped by the event\'s own organizationId', async () => {
      // Simulates the cross-org case: the command genuinely does not exist under this organizationId.
      commands.findByCommandId.mockResolvedValue(null);
      const event = buildEvent({ eventType: 'EXECUTION_ACCEPTED', commandId: 'cmd_from_another_org', payload: { serverExecutionId: 'srv_1' } });

      await projector.project(event, ctx);

      expect(commands.update).not.toHaveBeenCalled();
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'integration_event.command_not_found' }),
        ctx,
      );
    });

    it('records a conflict and never updates the command when aggregateId does not match', async () => {
      commands.findByCommandId.mockResolvedValue(buildCommand({ aggregateId: 'exec_DIFFERENT' }));
      const event = buildEvent({ eventType: 'EXECUTION_ACCEPTED', commandId: 'cmd_1', aggregateId: 'exec_1', payload: { serverExecutionId: 'srv_1' } });

      await projector.project(event, ctx);

      expect(commands.update).not.toHaveBeenCalled();
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'integration_event.command_aggregate_mismatch' }),
        ctx,
      );
    });

    it('never touches IntegrationCommand at all when the event carries no commandId', async () => {
      const event = buildEvent({ eventType: 'EXECUTION_ACCEPTED', commandId: null, payload: { serverExecutionId: 'srv_1' } });

      await projector.project(event, ctx);

      expect(commands.findByCommandId).not.toHaveBeenCalled();
    });
  });

  it('throws a non-retryable UNKNOWN_EVENT_TYPE error for anything the switch does not recognize', async () => {
    const event = buildEvent({ eventType: 'SOME_UNKNOWN_TYPE' as never });
    await expect(projector.project(event, ctx)).rejects.toMatchObject({ retryable: false, errorCode: 'UNKNOWN_EVENT_TYPE' });
  });
});
