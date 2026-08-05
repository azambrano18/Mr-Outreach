import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ContactRepository } from '../../domain/contact/contact.repository';
import { ConversationMessageRepository } from '../../domain/conversation/conversation-message.repository';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { SimulationConversationBatchRepository } from '../../domain/simulation-conversation/simulation-conversation-batch.repository';
import {
  AUDIT_LOG_REPOSITORY,
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  CONVERSATION_MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SIMULATION_CONVERSATION_BATCH_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { SimulationConversationsService } from './simulation-conversations.service';
import { GenerateSimulationConversationsInput, SimulationBatchSummary } from './simulation-conversations.types';
import { OUTBOUND_BODY, OUTBOUND_SUBJECT, QA_CLIENT_NAME, QA_COMPANY_NAME, SCENARIOS } from './simulation-scenarios';

const NOT_ELIGIBLE_MESSAGE = 'Debes vincular una cuenta de correo de prueba antes de generar las conversaciones.';
const ALREADY_ACTIVE_MESSAGE =
  'Ya existe un lote de conversaciones de prueba activo para esta organización. Elimínalo antes de generar uno nuevo.';

/**
 * "Conversaciones de prueba" (QA) — creates the 4 fixed scenario
 * conversations against a real, admin-selected staging Mailbox, using the
 * exact synthetic Sequence/SequenceContact/Contact/Company chain
 * ResponseOutcomeService already requires (`conversation.sequenceContactId`
 * non-null, resolving to a real SequenceContact/Contact — see that
 * service's `requireContext`). Deliberately sequential, uncommitted-as-a-
 * single-transaction awaits (mirrors DevSeedService.seedProspectThread):
 * Company/Contact/Sequence/SequenceStep repositories in this codebase have
 * never accepted a TransactionContext, so no atomic wrapping is possible
 * here without a broader, out-of-scope repository change. Never calls a
 * motor, never sends an email — every row is inserted directly through the
 * same repositories the rest of the app already uses.
 */
@Injectable()
export class GenerateSimulationConversationsUseCase {
  constructor(
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly mailboxAssignments: MailboxAssignmentRepository,
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly managedClients: ManagedClientRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly sequenceSteps: SequenceStepRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(CONVERSATION_MESSAGE_REPOSITORY) private readonly messages: ConversationMessageRepository,
    @Inject(SIMULATION_CONVERSATION_BATCH_REPOSITORY) private readonly batches: SimulationConversationBatchRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    private readonly simulationConversationsService: SimulationConversationsService,
  ) {}

  async execute(input: GenerateSimulationConversationsInput): Promise<SimulationBatchSummary> {
    // §13 — a verified retry (same idempotencyKey) returns the exact batch that call already created.
    const existingByKey = await this.batches.findByIdempotencyKey(input.organizationId, input.idempotencyKey);
    if (existingByKey) {
      return this.simulationConversationsService.toBatchSummary(existingByKey);
    }

    const active = await this.batches.findActiveByOrganization(input.organizationId);
    if (active) {
      throw new ConflictException(ALREADY_ACTIVE_MESSAGE);
    }

    const mailbox = await this.mailboxes.findById(input.mailboxId);
    if (!mailbox || mailbox.organizationId !== input.organizationId) {
      throw new BadRequestException(NOT_ELIGIBLE_MESSAGE);
    }
    const isAssignedToActor = (await this.mailboxAssignments.findByMailbox(mailbox.id)).some(
      (a) => a.userId === input.actorId,
    );
    if (!isAssignedToActor || mailbox.status !== 'ACTIVE' || mailbox.linkStatus === 'REVOKED') {
      throw new BadRequestException(NOT_ELIGIBLE_MESSAGE);
    }

    // The batch row is created FIRST — its mere existence is both the
    // idempotency ledger and the "is a batch already active" guard, so a
    // process crash mid-generation never leaves a second batch silently
    // creatable without first deleting the (now partial) one.
    const batch = await this.batches.create({
      organizationId: input.organizationId,
      mailboxId: mailbox.id,
      createdByUserId: input.actorId,
      idempotencyKey: input.idempotencyKey,
    });

    const client = await this.findOrCreateQaManagedClient(input.organizationId, input.actorId);
    const company = await this.companies.create({
      organizationId: input.organizationId,
      clientId: client.id,
      rawName: QA_COMPANY_NAME,
    });
    const sequence = await this.sequences.create({
      organizationId: input.organizationId,
      executiveId: input.actorId,
      name: 'Secuencia QA — Conversaciones de prueba',
      description:
        'Secuencia sintética usada exclusivamente por "Conversaciones de prueba" (simulación) — no representa una Gestión ni una Secuencia real, nunca despacha correos.',
      timezone: mailbox.timezone,
      createdBy: input.actorId,
    });
    const step = await this.sequenceSteps.create({
      organizationId: input.organizationId,
      sequenceId: sequence.id,
      position: 1,
      name: 'Envío 1 (QA)',
      subject: OUTBOUND_SUBJECT,
      htmlBody: `<p>${OUTBOUND_BODY}</p>`,
      plainTextBody: OUTBOUND_BODY,
      delayValue: 0,
      delayUnit: 'DAYS',
      sendMode: 'NEW_THREAD',
      createdBy: input.actorId,
    });
    // PUBLISHED so ResponseOutcomeService.refer()'s enrollAcceptedContacts
    // (only path that needs a publishable step) can succeed for "Deriva".
    await this.sequenceSteps.update(step.id, { status: 'PUBLISHED', updatedBy: input.actorId });
    // enrollAcceptedContacts requires BOTH sequence.mailboxId and
    // sequence.clientId to be set (see SchedulingService.enrollAcceptedContacts)
    // — mailboxId is a real, persisted column everywhere. clientId is NOT: the
    // Postgres-backed PrismaSequenceRepository has always hardcoded it to null
    // and silently dropped any value passed to update() (a pre-existing,
    // unrelated architectural gap this call does not attempt to work around —
    // see PrismaSequenceRepository's own comments). Under the in-memory driver
    // (dev/test) this update DOES take effect and "Deriva" fully succeeds;
    // under real Postgres it will not, exactly as it would not for any other
    // legacy Sequence today — disclosed, not silently patched over.
    await this.sequences.update(sequence.id, { mailboxId: mailbox.id, clientId: client.id });

    for (const config of SCENARIOS) {
      const contact = await this.contacts.create({
        organizationId: input.organizationId,
        clientId: client.id,
        companyId: company.id,
        email: config.email,
        firstName: config.firstName,
        lastName: config.lastName,
      });

      const sequenceContact = await this.sequenceContacts.create({
        organizationId: input.organizationId,
        clientId: client.id,
        sequenceId: sequence.id,
        sequenceVersion: sequence.sequenceVersion,
        contactId: contact.id,
        companyId: company.id,
        assignedMailboxId: mailbox.id,
        assignedExecutiveId: input.actorId,
        currentStepId: step.id,
        currentStepPosition: step.position,
      });

      const now = new Date();
      const conversation = await this.conversations.create({
        organizationId: input.organizationId,
        clientId: client.id,
        domainId: mailbox.domainId,
        mailboxId: mailbox.id,
        emailThreadId: `qa-sim-thread-${sequenceContact.id}`,
        contactEmail: contact.email,
        contactName: `${contact.firstName} ${contact.lastName}`,
        contactId: contact.id,
        companyId: company.id,
        origin: 'LEGACY_SEQUENCE',
        sequenceContactId: sequenceContact.id,
        sequenceId: sequence.id,
        sequenceStepId: step.id,
        assignedExecutiveId: input.actorId,
        subject: OUTBOUND_SUBJECT,
        isUnread: true,
        lastMessageAt: now,
        isSimulation: true,
        simulationBatchId: batch.id,
        simulationScenario: config.scenario,
      });

      await this.messages.create({
        organizationId: input.organizationId,
        conversationId: conversation.id,
        mailboxId: mailbox.id,
        emailMessageId: `qa-sim-out-${conversation.id}`,
        direction: 'OUTBOUND',
        senderEmail: mailbox.email,
        senderName: mailbox.fromName,
        recipients: [contact.email],
        subject: OUTBOUND_SUBJECT,
        htmlBody: `<p>${OUTBOUND_BODY}</p>`,
        plainTextBody: OUTBOUND_BODY,
        sentAt: now,
        messageType: 'OUTREACH_EMAIL',
      });
      await this.messages.create({
        organizationId: input.organizationId,
        conversationId: conversation.id,
        mailboxId: mailbox.id,
        emailMessageId: `qa-sim-in-${conversation.id}`,
        direction: 'INBOUND',
        senderEmail: contact.email,
        senderName: `${contact.firstName} ${contact.lastName}`,
        recipients: [mailbox.email],
        subject: OUTBOUND_SUBJECT,
        htmlBody: `<p>${config.replyText}</p>`,
        plainTextBody: config.replyText,
        receivedAt: now,
        messageType: 'HUMAN_REPLY',
      });

      await this.sequenceContacts.update(sequenceContact.id, { status: 'REPLIED' });
    }

    await this.auditLogs.record({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: 'simulation_conversations.create',
      entityType: 'SimulationConversationBatch',
      entityId: batch.id,
      metadata: { mailboxId: mailbox.id, sequenceId: sequence.id, companyId: company.id },
    });

    return this.simulationConversationsService.toBatchSummary(batch);
  }

  /** Reused across generations (never appears in DeleteSimulationConversationsUseCase's deletion list — see task §14) so the org never accumulates one orphaned ManagedClient per batch cycle. */
  private async findOrCreateQaManagedClient(organizationId: string, actorId: string) {
    const existing = (await this.managedClients.findAll(organizationId)).find((c) => c.name === QA_CLIENT_NAME);
    if (existing) return existing;
    return this.managedClients.create({
      organizationId,
      source: 'MANUAL',
      name: QA_CLIENT_NAME,
      notes: 'Cliente sintético reservado para "Conversaciones de prueba" (simulación) — nunca representa un cliente real.',
      createdBy: actorId,
    });
  }
}
