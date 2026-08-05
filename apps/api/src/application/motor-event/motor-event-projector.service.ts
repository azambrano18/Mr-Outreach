import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ConversationOrigin } from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { ConversationMessageRepository } from '../../domain/conversation/conversation-message.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { CommandStatus } from '../../domain/integration/integration-command.entity';
import { IntegrationCommandRepository } from '../../domain/integration/integration-command.repository';
import { IntegrationEvent } from '../../domain/integration/integration-event.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { TransactionContext } from '../../domain/persistence/transaction';
import { ProspectImportRowRepository } from '../../domain/prospect-import/prospect-import-row.repository';
import { SequenceExecutionRepository } from '../../domain/sequence-execution/sequence-execution.repository';
import {
  AUDIT_LOG_REPOSITORY,
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  CONVERSATION_MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
  INTEGRATION_COMMAND_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  PROSPECT_IMPORT_ROW_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
} from '../../infrastructure/persistence/tokens';

/** Thrown by a projector step to classify the failure — caught by ProcessMotorEventUseCase to decide FAILED_RETRYABLE vs FAILED_TERMINAL. */
export class MotorEventProjectionError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly errorCode: string) {
    super(message);
  }
}

/** EXECUTION_ACCEPTED/PROCESSING/COMPLETED/FAILED → IntegrationCommand.status — Fase 10's minimum mapping. */
const COMMAND_STATUS_BY_EVENT_TYPE: Partial<Record<string, CommandStatus>> = {
  EXECUTION_ACCEPTED: 'ACCEPTED',
  EXECUTION_PROCESSING: 'PROCESSING',
  EXECUTION_COMPLETED: 'COMPLETED',
  EXECUTION_FAILED: 'FAILED',
  // Fase "Control operativo de Gestiones" — same ACCEPTED-then-terminal
  // shape, advancing whichever control command this event's commandId
  // references (linkCommand resolves it generically by id).
  EXECUTION_PAUSE_ACCEPTED: 'ACCEPTED',
  EXECUTION_PAUSED: 'COMPLETED',
  EXECUTION_RESUME_ACCEPTED: 'ACCEPTED',
  EXECUTION_RESUMED: 'COMPLETED',
  EXECUTION_STOP_ACCEPTED: 'ACCEPTED',
  EXECUTION_STOPPED: 'COMPLETED',
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Fase "Recepción de eventos del motor" — the actual side-effect logic for
 * each active-flow event type, deliberately separate from
 * ProcessMotorEventUseCase (which only owns the durable-receipt/retry
 * envelope). Every method here assumes it's already running inside Etapa
 * B's transaction (a TransactionContext is always passed) and that the
 * IntegrationEvent row itself has already been dedup-checked — this class
 * never re-checks eventId uniqueness.
 */
@Injectable()
export class MotorEventProjector {
  constructor(
    @Inject(SEQUENCE_EXECUTION_REPOSITORY) private readonly executions: SequenceExecutionRepository,
    @Inject(PROSPECT_IMPORT_ROW_REPOSITORY) private readonly prospectRows: ProspectImportRowRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(CONVERSATION_MESSAGE_REPOSITORY) private readonly messages: ConversationMessageRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(INTEGRATION_COMMAND_REPOSITORY) private readonly commands: IntegrationCommandRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  async project(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    switch (event.eventType) {
      case 'EXECUTION_ACCEPTED':
        return this.projectExecutionAccepted(event, ctx);
      case 'EXECUTION_PROCESSING':
        return this.projectExecutionStatusOnly(event, ctx, 'RUNNING');
      case 'OUTBOUND_MESSAGE_CREATED':
        return this.projectOutboundMessageCreated(event, ctx);
      case 'OUTBOUND_MESSAGE_SENT':
        return this.projectOutboundMessageSent(event, ctx);
      case 'INBOUND_MESSAGE_RECEIVED':
        return this.projectInboundMessageReceived(event, ctx);
      case 'EXECUTION_COMPLETED':
        return this.projectExecutionStatusOnly(event, ctx, 'COMPLETED');
      case 'EXECUTION_FAILED':
        return this.projectExecutionFailed(event, ctx);
      case 'FUTURE_JOBS_CANCELLED':
        return this.projectFutureJobsCancelled(event, ctx);
      case 'EXECUTION_PAUSE_ACCEPTED':
        return this.projectControlAccepted(event, ctx);
      case 'EXECUTION_PAUSED':
        return this.projectControlTerminal(event, ctx, 'PAUSED');
      case 'EXECUTION_RESUME_ACCEPTED':
        return this.projectControlAccepted(event, ctx);
      case 'EXECUTION_RESUMED':
        return this.projectControlTerminal(event, ctx, 'RUNNING');
      case 'EXECUTION_STOP_ACCEPTED':
        return this.projectControlAccepted(event, ctx);
      case 'EXECUTION_STOPPED':
        return this.projectControlTerminal(event, ctx, 'STOPPED');
      default:
        throw new MotorEventProjectionError(`Tipo de evento no proyectable: ${event.eventType}`, false, 'UNKNOWN_EVENT_TYPE');
    }
  }

  // --- EXECUTION_* -----------------------------------------------------

  private async requireExecution(event: IntegrationEvent, ctx: TransactionContext) {
    if (!event.aggregateId) {
      throw new MotorEventProjectionError('Evento de ejecución sin aggregateId.', false, 'MISSING_AGGREGATE_ID');
    }
    const execution = await this.executions.findById(event.aggregateId, ctx);
    if (!execution || execution.organizationId !== event.organizationId) {
      throw new MotorEventProjectionError('SequenceExecution no encontrada para este evento.', false, 'EXECUTION_NOT_FOUND');
    }
    return execution;
  }

  private async projectExecutionAccepted(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    const execution = await this.requireExecution(event, ctx);
    const serverExecutionId = String(event.payload.serverExecutionId ?? '');
    await this.executions.update(execution.id, { status: 'ACCEPTED', serverExecutionId: serverExecutionId || execution.serverExecutionId, lastSyncedAt: new Date() }, ctx);
    await this.linkCommand(event, ctx);
    await this.audit(event, ctx, 'sequence_execution.motor_event.accepted', 'SequenceExecution', execution.id);
  }

  private async projectExecutionStatusOnly(
    event: IntegrationEvent,
    ctx: TransactionContext,
    status: 'RUNNING' | 'COMPLETED',
  ): Promise<void> {
    const execution = await this.requireExecution(event, ctx);
    await this.executions.update(
      execution.id,
      { status, lastSyncedAt: new Date(), ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}) },
      ctx,
    );
    await this.linkCommand(event, ctx);
    await this.audit(event, ctx, `sequence_execution.motor_event.${event.eventType.toLowerCase()}`, 'SequenceExecution', execution.id);
  }

  private async projectExecutionFailed(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    const execution = await this.requireExecution(event, ctx);
    const errorMessage = typeof event.payload.errorMessage === 'string' ? event.payload.errorMessage : 'El motor reportó un fallo.';
    await this.executions.update(
      execution.id,
      { status: 'FAILED', lastError: errorMessage, failedAt: new Date(), lastSyncedAt: new Date() },
      ctx,
    );
    await this.linkCommand(event, ctx);
    // §"no borrar conversaciones ni mensajes ya creados" — this handler never touches Conversation/ConversationMessage at all.
    await this.audit(event, ctx, 'sequence_execution.motor_event.failed', 'SequenceExecution', execution.id, { errorMessage });
  }

  // --- Fase "Control operativo de Gestiones" -----------------------------

  /**
   * ACCEPTED-phase confirmation for pause/resume/stop — purely
   * informational (the local status was already moved to its
   * *_REQUESTED transitional value by ControlSequenceExecutionUseCase
   * before the motor was ever called), so this only advances the linked
   * command and leaves an audit trail. Never touches the execution row.
   */
  private async projectControlAccepted(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    const execution = await this.requireExecution(event, ctx);
    await this.linkCommand(event, ctx);
    await this.audit(event, ctx, `sequence_execution.motor_event.${event.eventType.toLowerCase()}`, 'SequenceExecution', execution.id);
  }

  /**
   * Terminal confirmation for pause/resume/stop. Idempotent: if
   * ControlSequenceExecutionUseCase's own synchronous transaction already
   * moved the execution to this exact status (the normal case for the
   * synchronous simulated motor), this is a harmless no-op re-write of
   * the same value — kept so a future real, genuinely asynchronous motor
   * can rely on this event alone to reach the terminal state.
   */
  private async projectControlTerminal(
    event: IntegrationEvent,
    ctx: TransactionContext,
    status: 'PAUSED' | 'RUNNING' | 'STOPPED',
  ): Promise<void> {
    const execution = await this.requireExecution(event, ctx);
    const timestampField =
      status === 'PAUSED' ? { pausedAt: execution.pausedAt ?? new Date() }
      : status === 'RUNNING' ? { resumedAt: execution.resumedAt ?? new Date() }
      : { stoppedAt: execution.stoppedAt ?? new Date() };
    await this.executions.update(execution.id, { status, lastSyncedAt: new Date(), ...timestampField }, ctx);
    await this.linkCommand(event, ctx);
    await this.audit(event, ctx, `sequence_execution.motor_event.${event.eventType.toLowerCase()}`, 'SequenceExecution', execution.id);
  }

  // --- OUTBOUND_MESSAGE_* ------------------------------------------------

  private async projectOutboundMessageCreated(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    const execution = await this.requireExecution(event, ctx);
    const payload = event.payload;
    const outboundMessageId = String(payload.outboundMessageId ?? '');
    const prospectImportRowId = String(payload.prospectImportRowId ?? '');
    const mailboxId = String(payload.mailboxId ?? execution.mailboxId);

    const mailbox = await this.mailboxes.findById(mailboxId, ctx);
    if (!mailbox || mailbox.organizationId !== event.organizationId) {
      throw new MotorEventProjectionError('Mailbox no encontrado para este evento.', false, 'MAILBOX_NOT_FOUND');
    }
    const row = await this.prospectRows.findById(prospectImportRowId, ctx);
    if (!row || row.organizationId !== event.organizationId) {
      throw new MotorEventProjectionError('ProspectImportRow no encontrada para este evento.', false, 'PROSPECT_ROW_NOT_FOUND');
    }

    const contact = row.contactId ? await this.contacts.findById(row.contactId) : null;
    const company = row.companyId ? await this.companies.findById(row.companyId) : null;
    const recipientEmail = contact?.email ?? String(payload.recipientEmail ?? row.normalizedData?.email ?? '');

    // Fase 7 — stable identity priority: motor threadId > outboundMessageId > mailbox+execution+row. Never subject alone.
    const threadId =
      (typeof payload.threadId === 'string' && payload.threadId) ||
      outboundMessageId ||
      `exec_${execution.id}_row_${row.id}`;

    let conversation = await this.conversations.findByMailboxAndThread(mailboxId, threadId, ctx);
    if (!conversation) {
      const primaryAssignment = (await this.assignments.findByMailbox(mailboxId, ctx)).find((a) => a.role === 'PRIMARY');
      conversation = await this.conversations.create(
        {
          organizationId: event.organizationId,
          clientId: mailbox.clientId,
          domainId: mailbox.domainId,
          mailboxId,
          emailThreadId: threadId,
          contactEmail: recipientEmail,
          contactName: contact?.fullName ?? null,
          companyNameSnapshot: company?.rawName ?? (typeof row.normalizedData?.companyName === 'string' ? row.normalizedData.companyName : null),
          contactId: row.contactId,
          companyId: row.companyId,
          origin: 'ACTIVE_EXECUTION' as ConversationOrigin,
          sequenceExecutionId: execution.id,
          prospectImportRowId: row.id,
          assignedExecutiveId: primaryAssignment?.userId ?? execution.executiveId,
          subject: String(payload.subject ?? ''),
          isUnread: false,
          lastMessageAt: event.occurredAt ?? new Date(),
        },
        ctx,
      );
    }

    const existingMessage = outboundMessageId
      ? await this.messages.findByOutboundMessageId(event.organizationId, outboundMessageId, ctx)
      : null;
    if (existingMessage) {
      // Already projected by an earlier attempt at this same event — never duplicate.
      return;
    }

    await this.messages.create(
      {
        organizationId: event.organizationId,
        conversationId: conversation.id,
        mailboxId,
        emailMessageId: outboundMessageId || `evt_${event.eventId}`,
        direction: 'OUTBOUND',
        outboundMessageId: outboundMessageId || null,
        serverMessageId: typeof payload.serverMessageId === 'string' ? payload.serverMessageId : null,
        senderEmail: mailbox.email,
        senderName: mailbox.fromName,
        recipients: [recipientEmail].filter(Boolean),
        subject: String(payload.subject ?? ''),
        htmlBody: String(payload.htmlBody ?? ''),
        plainTextBody: String(payload.plainTextBody ?? ''),
        stepNumber: typeof payload.stepNumber === 'number' ? payload.stepNumber : null,
        sentAt: null,
        messageType: 'OUTREACH_EMAIL',
      },
      ctx,
    );

    await this.linkCommand(event, ctx);
    await this.audit(event, ctx, 'conversation.motor_event.outbound_created', 'Conversation', conversation.id, {
      sequenceExecutionId: execution.id,
      prospectImportRowId: row.id,
    });
  }

  private async projectOutboundMessageSent(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    const outboundMessageId = String(event.payload.outboundMessageId ?? '');
    const message = await this.messages.findByOutboundMessageId(event.organizationId, outboundMessageId, ctx);
    if (!message) {
      // OUTBOUND_MESSAGE_CREATED may not have landed yet (out-of-order delivery) — safe to retry.
      throw new MotorEventProjectionError(
        'No existe ConversationMessage OUTBOUND para outboundMessageId — reintentable si aún no llegó OUTBOUND_MESSAGE_CREATED.',
        true,
        'OUTBOUND_MESSAGE_NOT_FOUND',
      );
    }
    const sentAt = typeof event.payload.sentAt === 'string' ? new Date(event.payload.sentAt) : event.occurredAt ?? new Date();
    await this.messages.update(
      message.id,
      {
        sentAt,
        serverMessageId: typeof event.payload.serverMessageId === 'string' ? event.payload.serverMessageId : message.serverMessageId,
        messageIdHeader: typeof event.payload.messageIdHeader === 'string' ? event.payload.messageIdHeader : message.messageIdHeader,
      },
      ctx,
    );
    await this.audit(event, ctx, 'conversation.motor_event.outbound_sent', 'ConversationMessage', message.id);
  }

  // --- INBOUND_MESSAGE_RECEIVED -----------------------------------------

  private async resolveConversationForInbound(event: IntegrationEvent, ctx: TransactionContext) {
    const payload = event.payload;
    const mailboxId = String(payload.mailboxId ?? '');

    // Priority 1: In-Reply-To.
    if (typeof payload.inReplyTo === 'string' && payload.inReplyTo) {
      const found = await this.messages.findByMessageIdHeader(event.organizationId, payload.inReplyTo, ctx);
      if (found) return { conversationId: found.conversationId, resolvedBy: 'IN_REPLY_TO' as const };
    }
    // Priority 2: References (may list several ancestor Message-IDs; try each).
    if (typeof payload.references === 'string' && payload.references) {
      const candidates = payload.references.split(/\s+/).filter(Boolean);
      for (const candidate of candidates.reverse()) {
        const found = await this.messages.findByMessageIdHeader(event.organizationId, candidate, ctx);
        if (found) return { conversationId: found.conversationId, resolvedBy: 'REFERENCES' as const };
      }
    }
    // Priority 3: outboundMessageId.
    if (typeof payload.outboundMessageId === 'string' && payload.outboundMessageId) {
      const found = await this.messages.findByOutboundMessageId(event.organizationId, payload.outboundMessageId, ctx);
      if (found) return { conversationId: found.conversationId, resolvedBy: 'OUTBOUND_MESSAGE_ID' as const };
    }
    // Priority 4: serverExecutionId + prospectImportRowId.
    if (typeof payload.serverExecutionId === 'string' && payload.serverExecutionId && typeof payload.prospectImportRowId === 'string') {
      const execution = await this.executions.findByServerExecutionId(payload.serverExecutionId, ctx);
      if (execution) {
        const threadId = `exec_${execution.id}_row_${payload.prospectImportRowId}`;
        const found = await this.conversations.findByMailboxAndThread(mailboxId, threadId, ctx);
        if (found) return { conversationId: found.id, resolvedBy: 'EXECUTION_AND_ROW' as const };
      }
    }
    // Priority 5 (last resort, controlled): mailbox + normalized email — never subject alone.
    if (mailboxId && typeof payload.senderEmail === 'string' && payload.senderEmail) {
      const matches = await this.conversations.findAll(event.organizationId, {
        mailboxId,
        contactEmail: normalizeEmail(payload.senderEmail),
      });
      if (matches.length > 0) return { conversationId: matches[0].id, resolvedBy: 'MAILBOX_AND_EMAIL' as const };
    }
    return null;
  }

  private async projectInboundMessageReceived(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    const payload = event.payload;
    const mailboxId = String(payload.mailboxId ?? '');
    const mailbox = await this.mailboxes.findById(mailboxId, ctx);
    if (!mailbox || mailbox.organizationId !== event.organizationId) {
      throw new MotorEventProjectionError('Mailbox no encontrado para este evento.', false, 'MAILBOX_NOT_FOUND');
    }

    const resolution = await this.resolveConversationForInbound(event, ctx);
    let conversationId: string;

    if (resolution) {
      conversationId = resolution.conversationId;
      await this.conversations.update(conversationId, { isUnread: true, lastMessageAt: event.occurredAt ?? new Date() }, ctx);
    } else {
      // §"contacto desconocido" — never reject the event; persist as EXTERNAL_INBOUND, contactId left null, linkable later.
      const senderEmail = typeof payload.senderEmail === 'string' ? normalizeEmail(payload.senderEmail) : 'desconocido@sin-datos.test';
      const threadId = `ext_${mailboxId}_${senderEmail}`;
      let conversation = await this.conversations.findByMailboxAndThread(mailboxId, threadId, ctx);
      if (!conversation) {
        conversation = await this.conversations.create(
          {
            organizationId: event.organizationId,
            clientId: mailbox.clientId,
            domainId: mailbox.domainId,
            mailboxId,
            emailThreadId: threadId,
            contactEmail: senderEmail,
            contactName: typeof payload.senderName === 'string' ? payload.senderName : null,
            origin: 'EXTERNAL_INBOUND' as ConversationOrigin,
            assignedExecutiveId: null,
            subject: String(payload.subject ?? ''),
            isUnread: true,
            lastMessageAt: event.occurredAt ?? new Date(),
          },
          ctx,
        );
      } else {
        await this.conversations.update(conversation.id, { isUnread: true, lastMessageAt: event.occurredAt ?? new Date() }, ctx);
      }
      conversationId = conversation.id;
    }

    const emailMessageId = String(payload.emailMessageId ?? `evt_${event.eventId}`);
    const existing = await this.messages.findByEmailMessageId(conversationId, emailMessageId);
    if (existing) return;

    await this.messages.create(
      {
        organizationId: event.organizationId,
        conversationId,
        mailboxId,
        emailMessageId,
        direction: 'INBOUND',
        messageIdHeader: typeof payload.messageIdHeader === 'string' ? payload.messageIdHeader : null,
        inReplyTo: typeof payload.inReplyTo === 'string' ? payload.inReplyTo : null,
        references: typeof payload.references === 'string' ? payload.references : null,
        senderEmail: typeof payload.senderEmail === 'string' ? payload.senderEmail : 'desconocido@sin-datos.test',
        senderName: typeof payload.senderName === 'string' ? payload.senderName : null,
        recipients: [mailbox.email],
        subject: String(payload.subject ?? ''),
        htmlBody: String(payload.htmlBody ?? ''),
        plainTextBody: String(payload.plainTextBody ?? ''),
        receivedAt: event.occurredAt ?? new Date(),
        messageType: 'HUMAN_REPLY',
      },
      ctx,
    );

    await this.audit(event, ctx, 'conversation.motor_event.inbound_received', 'Conversation', conversationId, {
      resolvedBy: resolution?.resolvedBy ?? 'EXTERNAL_UNMATCHED',
    });
  }

  // --- FUTURE_JOBS_CANCELLED ---------------------------------------------

  private async projectFutureJobsCancelled(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    // Purely informational — the motor owns all scheduling for the active
    // flow (confirmed: no local per-email queue exists for Gestiones), so
    // there is nothing local to cancel. Never touches Conversation/
    // ConversationMessage/Contact/Company — messages and replies already
    // persisted are never removed.
    await this.audit(event, ctx, 'sequence_execution.motor_event.future_jobs_cancelled', 'SequenceExecution', event.aggregateId ?? 'unknown', {
      contactId: event.payload.contactId,
      companyId: event.payload.companyId,
      reason: event.payload.reason,
    });
  }

  // --- shared helpers -----------------------------------------------------

  /** Fase 10 — links the event back to its IntegrationCommand, when one is referenced, with the organization/aggregate cross-checks required. */
  private async linkCommand(event: IntegrationEvent, ctx: TransactionContext): Promise<void> {
    if (!event.commandId) return;
    const command = await this.commands.findByCommandId(event.organizationId, event.commandId);
    if (!command) {
      // Never create a command to paper over the inconsistency — just record it.
      await this.auditLogs.record(
        {
          organizationId: event.organizationId,
          actorId: null,
          action: 'integration_event.command_not_found',
          entityType: 'IntegrationEvent',
          entityId: event.id,
          metadata: { commandId: event.commandId, eventType: event.eventType },
        },
        ctx,
      );
      return;
    }
    if (
      (event.aggregateType && command.aggregateType !== event.aggregateType) ||
      (event.aggregateId && command.aggregateId !== event.aggregateId)
    ) {
      await this.auditLogs.record(
        {
          organizationId: event.organizationId,
          actorId: null,
          action: 'integration_event.command_aggregate_mismatch',
          entityType: 'IntegrationEvent',
          entityId: event.id,
          metadata: {
            commandId: event.commandId,
            eventAggregateType: event.aggregateType,
            eventAggregateId: event.aggregateId,
            commandAggregateType: command.aggregateType,
            commandAggregateId: command.aggregateId,
          },
        },
        ctx,
      );
      return;
    }
    const nextStatus = COMMAND_STATUS_BY_EVENT_TYPE[event.eventType];
    if (!nextStatus) return;
    await this.commands.update(
      command.id,
      { status: nextStatus, ...(nextStatus === 'COMPLETED' || nextStatus === 'FAILED' ? { completedAt: new Date() } : {}) },
      ctx,
    );
  }

  private async audit(
    event: IntegrationEvent,
    ctx: TransactionContext,
    action: string,
    entityType: string,
    entityId: string,
    extraMetadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.auditLogs.record(
      {
        organizationId: event.organizationId,
        actorId: null,
        action,
        entityType,
        entityId,
        metadata: { eventId: event.eventId, eventType: event.eventType, correlationId: event.correlationId, ...extraMetadata },
      },
      ctx,
    );
  }
}

// Re-exported so callers constructing a synthetic id don't need node:crypto directly.
export function generateSyntheticId(): string {
  return randomUUID();
}
