import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { ClientExecutiveAssignmentRepository } from '../../domain/client/client-executive-assignment.repository';
import { ManagedClientRepository } from '../../domain/client/managed-client.repository';
import { CompanyRepository } from '../../domain/company/company.repository';
import { ConversationMessageRepository } from '../../domain/conversation/conversation-message.repository';
import { ConversationNoteRepository } from '../../domain/conversation/conversation-note.repository';
import { ConversationReadStateRepository } from '../../domain/conversation/conversation-read-state.repository';
import { ConversationTagRepository } from '../../domain/conversation/conversation-tag.repository';
import { isConversationUnreadForUser } from '../../domain/conversation/conversation-unread.policy';
import {
  Conversation,
  ConversationClassification,
  ConversationManagementStatus,
  ResponseOutcome,
} from '../../domain/conversation/conversation.entity';
import { ConversationRepository } from '../../domain/conversation/conversation.repository';
import { DomainRepository } from '../../domain/domain-entity/domain.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { ScheduledEmailRepository } from '../../domain/scheduled-email/scheduled-email.repository';
import { SequenceContactRepository } from '../../domain/sequence-contact/sequence-contact.repository';
import { SequenceStepRepository } from '../../domain/sequence/sequence-step.repository';
import { Sequence } from '../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../domain/sequence/sequence.repository';
import { fullName } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import {
  AUDIT_LOG_REPOSITORY,
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
  COMPANY_REPOSITORY,
  CONVERSATION_MESSAGE_REPOSITORY,
  CONVERSATION_NOTE_REPOSITORY,
  CONVERSATION_READ_STATE_REPOSITORY,
  CONVERSATION_REPOSITORY,
  CONVERSATION_TAG_REPOSITORY,
  DOMAIN_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  USER_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { SequencesService } from '../sequences/sequences.service';
import { classifyInboundMessage } from './conversation-classifier';
import {
  ConversationCounters,
  ConversationDetail,
  ConversationListFilter,
  ConversationMessageSummary,
  ConversationNoteSummary,
  ConversationSummary,
  ConversationTagSummary,
  ConversationTreeClientNode,
  CreateConversationNotePayload,
  CreateConversationTagPayload,
  UpdateConversationNotePayload,
  UpdateConversationTagPayload,
} from './conversations.types';

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepository,
    @Inject(CONVERSATION_MESSAGE_REPOSITORY)
    private readonly messages: ConversationMessageRepository,
    @Inject(CONVERSATION_TAG_REPOSITORY) private readonly tags: ConversationTagRepository,
    @Inject(CONVERSATION_NOTE_REPOSITORY) private readonly notes: ConversationNoteRepository,
    @Inject(CONVERSATION_READ_STATE_REPOSITORY) private readonly readStates: ConversationReadStateRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(SEQUENCE_REPOSITORY) private readonly sequences: SequenceRepository,
    @Inject(MANAGED_CLIENT_REPOSITORY) private readonly clients: ManagedClientRepository,
    @Inject(DOMAIN_REPOSITORY) private readonly domains: DomainRepository,
    @Inject(CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY)
    private readonly clientAssignments: ClientExecutiveAssignmentRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY)
    private readonly mailboxAssignments: MailboxAssignmentRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
    @Inject(COMPANY_REPOSITORY) private readonly companies: CompanyRepository,
    @Inject(SCHEDULED_EMAIL_REPOSITORY) private readonly scheduledEmails: ScheduledEmailRepository,
    @Inject(SEQUENCE_STEP_REPOSITORY) private readonly sequenceSteps: SequenceStepRepository,
    @Inject(SEQUENCE_CONTACT_REPOSITORY) private readonly sequenceContacts: SequenceContactRepository,
    private readonly mailboxesService: MailboxesService,
    private readonly sequencesService: SequencesService,
  ) {}

  /**
   * Materializes the engine's read-through inbox into persisted
   * Conversation/ConversationMessage rows — reuses MailboxesService.
   * getInbox/getThread (the SAME IMAP-read integration point this app has
   * always had) instead of talking to the engine a second time. There is
   * no background worker anywhere in this codebase (confirmed absent) —
   * sync is deliberately on-demand, triggered whenever a conversation
   * list is requested for a given mailbox, not by a cron/queue that
   * doesn't exist. Idempotent: re-running never duplicates a thread or
   * message already persisted.
   */
  async syncMailbox(
    organizationId: string,
    mailboxId: string,
    actorId: string,
  ): Promise<{ created: number; updated: number }> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Mailbox not found.');
    }

    const inbox = await this.mailboxesService.getInbox(organizationId, mailboxId);
    if (inbox.status !== 'OK') {
      return { created: 0, updated: 0 };
    }

    const candidateSequence = await this.findCandidateSequence(organizationId, mailbox);

    let created = 0;
    let updated = 0;

    for (const thread of inbox.threads) {
      const existing = await this.conversations.findByMailboxAndThread(mailboxId, thread.id);
      const participant = thread.participants[0];
      const classification = classifyInboundMessage(thread.subject, thread.lastMessageSnippet);

      if (!existing) {
        const isHumanSignal =
          classification.messageType === 'HUMAN_REPLY' ||
          classification.messageType === 'HARD_BOUNCE' ||
          classification.messageType === 'UNSUBSCRIBE';
        const associatedSequence = isHumanSignal ? candidateSequence : null;

        const conversation = await this.conversations.create({
          organizationId,
          clientId: mailbox.clientId,
          domainId: mailbox.domainId,
          mailboxId,
          emailThreadId: thread.id,
          contactEmail: participant?.email ?? 'desconocido@sin-datos.test',
          contactName: participant?.name ?? null,
          // Attributed to a legacy Sequence when the heuristic match found
          // one; otherwise a genuinely unidentified sender — persisted with
          // contactId left null, never rejected, linkable to a real Contact
          // later (see ResponseOutcomeService/manual-association flow).
          origin: associatedSequence ? 'LEGACY_SEQUENCE' : 'EXTERNAL_INBOUND',
          sequenceId: associatedSequence?.id ?? null,
          sequenceStepId: null,
          assignedExecutiveId: associatedSequence?.executiveId ?? null,
          subject: thread.subject,
          classification: classification.classification,
          isUnread: thread.unreadCount > 0,
          lastMessageAt: new Date(thread.lastMessageAt),
        });

        await this.syncMessages(organizationId, mailbox, conversation, thread.id, classification);

        if (associatedSequence && associatedSequence.status === 'DRAFT') {
          await this.autoStopSequence(
            organizationId,
            associatedSequence,
            conversation.id,
            classification.classification,
            actorId,
          );
        }

        created += 1;
      } else {
        const threadLastMessageAt = new Date(thread.lastMessageAt);
        if (
          threadLastMessageAt.getTime() > existing.lastMessageAt.getTime() ||
          existing.isUnread !== thread.unreadCount > 0
        ) {
          await this.conversations.update(existing.id, {
            lastMessageAt: threadLastMessageAt,
            isUnread: thread.unreadCount > 0,
          });
        }
        await this.syncMessages(organizationId, mailbox, existing, thread.id, classification);
        updated += 1;
      }
    }

    return { created, updated };
  }

  async syncMailboxes(
    organizationId: string,
    mailboxIds: string[],
    actorId: string,
  ): Promise<void> {
    for (const mailboxId of mailboxIds) {
      try {
        await this.syncMailbox(organizationId, mailboxId, actorId);
      } catch {
        // A single unreachable/misconfigured mailbox must not break the
        // whole conversation list — its existing conversations (if any)
        // still show, just without fresh data this pass.
      }
    }
  }

  async list(
    organizationId: string,
    filter: ConversationListFilter,
    mailboxIdsToSync: string[],
    actorId: string,
  ): Promise<ConversationSummary[]> {
    await this.syncMailboxes(organizationId, mailboxIdsToSync, actorId);
    // isUnread is never pushed down to the repository here — it is a
    // per-user computed value, not a column the DB can filter on for
    // "the current caller" (see ConversationReadState's own doc comment).
    const { isUnread: wantUnread, ...dbFilter } = filter;
    const rows = await this.conversations.findAll(organizationId, dbFilter);
    const unreadMap = await this.computeUnreadMap(organizationId, actorId, rows.map((row) => row.id));
    const filtered = wantUnread === undefined ? rows : rows.filter((row) => (unreadMap.get(row.id) ?? false) === wantUnread);
    return Promise.all(filtered.map((row) => this.toSummary(row, unreadMap.get(row.id))));
  }

  async counters(
    organizationId: string,
    filter: ConversationListFilter,
    mailboxIdsToSync: string[],
    actorId: string,
  ): Promise<ConversationCounters> {
    await this.syncMailboxes(organizationId, mailboxIdsToSync, actorId);
    const { isUnread: _ignored, ...dbFilter } = filter;
    const [all, statusNew, statusPending, statusInProgress] = await Promise.all([
      this.conversations.findAll(organizationId, dbFilter),
      this.conversations.findAll(organizationId, { ...dbFilter, managementStatus: 'NEW' }),
      this.conversations.findAll(organizationId, { ...dbFilter, managementStatus: 'PENDING' }),
      this.conversations.findAll(organizationId, { ...dbFilter, managementStatus: 'IN_PROGRESS' }),
    ]);
    const unreadMap = await this.computeUnreadMap(organizationId, actorId, all.map((row) => row.id));
    const unreadCount = all.filter((row) => unreadMap.get(row.id)).length;
    return {
      total: all.length,
      new: statusNew.length,
      pending: statusNew.length + statusPending.length + statusInProgress.length,
      unread: unreadCount,
    };
  }

  /**
   * Self-service listing — "Mis clientes" scoping applied here, not just
   * hidden in the UI. Visible conversations are those belonging to a
   * client assigned to this executive, directly assigned to them (e.g. by
   * a supervisor, even outside their usual client scope), OR belonging to
   * a mailbox where they hold an active MailboxAssignment (PRIMARY or
   * SECONDARY) — the same assignment used to gate Plantillas/Gestiones
   * (§2 of the admin-operational-capabilities follow-up). This is a pure
   * union of two independent assignment mechanisms, never a role check:
   * an admin operating as an executive reaches this exact same method,
   * scoped only by their own MailboxAssignment rows.
   */
  async listForExecutive(
    organizationId: string,
    userId: string,
    filter: ConversationListFilter,
    actorId: string,
  ): Promise<ConversationSummary[]> {
    const assignedClientIds = await this.assignedClientIdSet(userId);
    const assignedMailboxIds = await this.assignedMailboxIdSet(userId);
    // Deliberately no early "filter.clientId not in assignedClientIds -> []"
    // rejection here: a ClientExecutiveAssignment is only ONE of the three
    // authorized visibility mechanisms (see this method's own doc comment
    // above) — a user with only a MailboxAssignment on a mailbox never has
    // the mailbox's clientId in assignedClientIds, so that check used to
    // wrongly reject every request that legitimately passed clientId (e.g.
    // the account-tree UI, which always sends clientId/domainId/mailboxId
    // together for a selected mailbox). The row-level `visible` filter below
    // is the real, final security boundary and already covers this case.
    const allMailboxes = await this.mailboxes.findAll(organizationId);
    const mailboxIdsInScope = allMailboxes
      .filter(
        (mailbox) =>
          (mailbox.clientId && assignedClientIds.has(mailbox.clientId)) ||
          assignedMailboxIds.has(mailbox.id),
      )
      .map((mailbox) => mailbox.id);
    await this.syncMailboxes(organizationId, mailboxIdsInScope, actorId);

    const { isUnread: wantUnread, ...dbFilter } = filter;
    const rows = await this.conversations.findAll(organizationId, dbFilter);
    const visible = rows.filter(
      (row) =>
        (row.clientId && assignedClientIds.has(row.clientId)) ||
        row.assignedExecutiveId === userId ||
        assignedMailboxIds.has(row.mailboxId),
    );
    // Unread is computed for the actual VIEWER (actorId — an admin acting
    // "as executive" would still see their own read state, never the
    // owning executive's), which is why this reads `actorId`, not `userId`.
    const unreadMap = await this.computeUnreadMap(organizationId, actorId, visible.map((row) => row.id));
    const filtered =
      wantUnread === undefined ? visible : visible.filter((row) => (unreadMap.get(row.id) ?? false) === wantUnread);
    return Promise.all(filtered.map((row) => this.toSummary(row, unreadMap.get(row.id))));
  }

  async countersForExecutive(
    organizationId: string,
    userId: string,
    filter: ConversationListFilter,
    actorId: string,
  ): Promise<ConversationCounters> {
    const all = await this.listForExecutive(organizationId, userId, filter, actorId);
    const newCount = all.filter((c) => c.managementStatus === 'NEW').length;
    const pendingCount = all.filter((c) =>
      (['NEW', 'PENDING', 'IN_PROGRESS'] as const).includes(
        c.managementStatus as 'NEW' | 'PENDING' | 'IN_PROGRESS',
      ),
    ).length;
    const unreadCount = all.filter((c) => c.isUnread).length;
    return { total: all.length, new: newCount, pending: pendingCount, unread: unreadCount };
  }

  /**
   * "Cuentas de correos" — the executive workspace's Cliente → Dominio →
   * Cuenta tree, each node carrying its own aggregated unread count (sum of
   * its children's). Scoped by the union of `listForExecutive`'s two
   * assignment mechanisms: a `ClientExecutiveAssignment` grants full access
   * to every mailbox under that client (existing behavior, unchanged); a
   * `MailboxAssignment` (PRIMARY/SECONDARY) grants access to just that one
   * mailbox even when its client isn't otherwise assigned to this user —
   * needed so a mailbox self-assigned via "Cuentas de Correos" (§4 of the
   * admin-operational-capabilities follow-up) actually surfaces here. Either
   * way this never leaks a client/domain/mailbox the user isn't assigned to.
   */
  async getConversationTreeForExecutive(
    organizationId: string,
    userId: string,
    actorId: string,
  ): Promise<ConversationTreeClientNode[]> {
    const clientAssignmentRows = await this.clientAssignments.findByUser(userId);
    const fullAccessClientIds = new Set(clientAssignmentRows.map((a) => a.clientId));
    const assignedMailboxIds = await this.assignedMailboxIdSet(userId);
    const allMailboxes = await this.mailboxes.findAll(organizationId);

    const mailboxIdsInScope = allMailboxes
      .filter(
        (mailbox) =>
          (mailbox.clientId && fullAccessClientIds.has(mailbox.clientId)) ||
          assignedMailboxIds.has(mailbox.id),
      )
      .map((mailbox) => mailbox.id);
    await this.syncMailboxes(organizationId, mailboxIdsInScope, actorId);

    const clientIdsFromMailboxAssignment = new Set(
      allMailboxes
        .filter((mailbox) => assignedMailboxIds.has(mailbox.id) && mailbox.clientId)
        .map((mailbox) => mailbox.clientId as string),
    );
    const allClientIds = new Set([...fullAccessClientIds, ...clientIdsFromMailboxAssignment]);

    const tree: ConversationTreeClientNode[] = [];
    for (const clientId of allClientIds) {
      const client = await this.clients.findById(clientId);
      if (!client || client.organizationId !== organizationId) continue;
      const hasFullClientAccess = fullAccessClientIds.has(clientId);

      const domains = await this.domains.findByClient(organizationId, client.id);
      let clientUnread = 0;
      const domainNodes = await Promise.all(
        domains.map(async (domain) => {
          const mailboxesInDomain = allMailboxes.filter(
            (mailbox) =>
              mailbox.domainId === domain.id &&
              (hasFullClientAccess || assignedMailboxIds.has(mailbox.id)),
          );
          let domainUnread = 0;
          const mailboxNodes = await Promise.all(
            mailboxesInDomain.map(async (mailbox) => {
              const rows = await this.conversations.findAll(organizationId, { mailboxId: mailbox.id });
              // Per-user badge (the actual viewer, actorId) — never the
              // coarse Conversation.isUnread flag (see toSummary's comment).
              const unreadMap = await this.computeUnreadMap(organizationId, actorId, rows.map((row) => row.id));
              const unreadCount = rows.filter((row) => unreadMap.get(row.id)).length;
              domainUnread += unreadCount;
              return { id: mailbox.id, email: mailbox.email, unreadCount };
            }),
          );
          clientUnread += domainUnread;
          return { id: domain.id, domainName: domain.domainName, unreadCount: domainUnread, mailboxes: mailboxNodes };
        }),
      );
      // A client reached only THROUGH a mailbox-assignment (never a full
      // ClientExecutiveAssignment) must never show its other, unassigned
      // domains/mailboxes as empty folders — prune those here. A client with
      // full access keeps every domain exactly as before this change, even
      // an empty one, since that was already the pre-existing behavior.
      const domainsToShow = hasFullClientAccess
        ? domainNodes
        : domainNodes.filter((domain) => domain.mailboxes.length > 0);
      if (domainsToShow.length === 0) continue;

      tree.push({ id: client.id, name: client.name, unreadCount: clientUnread, domains: domainsToShow });
    }
    return tree;
  }

  /**
   * Admin equivalent of getConversationTreeForExecutive (spec §7) — scoped
   * directly by `clientId` (already validated/fixed by the caller's route),
   * never by any executive's own assignments, so every domain/mailbox under
   * this client is visible regardless of who it's assigned to.
   */
  async getConversationTreeForClient(
    organizationId: string,
    clientId: string,
    actorId: string,
  ): Promise<ConversationTreeClientNode[]> {
    const client = await this.clients.findById(clientId);
    if (!client || client.organizationId !== organizationId) {
      throw new NotFoundException('Client not found.');
    }

    const allMailboxes = await this.mailboxes.findAll(organizationId);
    const mailboxIdsInScope = allMailboxes
      .filter((mailbox) => mailbox.clientId === clientId)
      .map((mailbox) => mailbox.id);
    await this.syncMailboxes(organizationId, mailboxIdsInScope, actorId);

    const domains = await this.domains.findByClient(organizationId, client.id);
    let clientUnread = 0;
    const domainNodes = await Promise.all(
      domains.map(async (domain) => {
        const mailboxesInDomain = allMailboxes.filter((mailbox) => mailbox.domainId === domain.id);
        let domainUnread = 0;
        const mailboxNodes = await Promise.all(
          mailboxesInDomain.map(async (mailbox) => {
            const rows = await this.conversations.findAll(organizationId, { mailboxId: mailbox.id });
            // Per-user badge for THIS admin (actorId) — an admin's own
            // read state, independent of any executive's.
            const unreadMap = await this.computeUnreadMap(organizationId, actorId, rows.map((row) => row.id));
            const unreadCount = rows.filter((row) => unreadMap.get(row.id)).length;
            domainUnread += unreadCount;
            return { id: mailbox.id, email: mailbox.email, unreadCount };
          }),
        );
        clientUnread += domainUnread;
        return { id: domain.id, domainName: domain.domainName, unreadCount: domainUnread, mailboxes: mailboxNodes };
      }),
    );

    return [{ id: client.id, name: client.name, unreadCount: clientUnread, domains: domainNodes }];
  }

  /** The genuine "executive opened this conversation" entry point — marks it read. */
  async getByIdForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
  ): Promise<ConversationDetail> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.getById(organizationId, conversationId, { markAsRead: true, actorId: userId });
  }

  /**
   * 404s (never 403) for a conversation outside this executive's reach. The
   * backend is always the one revalidating this — a deep link/query-string
   * carrying a `mailboxId` the caller isn't assigned to can never surface
   * that mailbox's conversations, no matter what the frontend requested.
   */
  async requireAccessibleConversation(
    organizationId: string,
    userId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.getOwnedConversation(organizationId, conversationId);
    if (conversation.assignedExecutiveId === userId) return conversation;
    if (conversation.clientId) {
      const assignedClientIds = await this.assignedClientIdSet(userId);
      if (assignedClientIds.has(conversation.clientId)) return conversation;
    }
    const assignedMailboxIds = await this.assignedMailboxIdSet(userId);
    if (assignedMailboxIds.has(conversation.mailboxId)) return conversation;
    throw new NotFoundException('Conversation not found.');
  }

  private async assignedClientIdSet(userId: string): Promise<Set<string>> {
    const clientAssignments = await this.clientAssignments.findByUser(userId);
    return new Set(clientAssignments.map((assignment) => assignment.clientId));
  }

  /** §2 — active MailboxAssignment (PRIMARY or SECONDARY; both are always "active", there is no separate revocation flag on this row — removal is a hard delete, see MailboxAssignmentRepository.remove) on a mailbox, independent of any client-level assignment. */
  private async assignedMailboxIdSet(userId: string): Promise<Set<string>> {
    const mailboxAssignments = await this.mailboxAssignments.findByUser(userId);
    return new Set(mailboxAssignments.map((assignment) => assignment.mailboxId));
  }

  // --- Self-service wrappers — each checks requireAccessibleConversation
  // before delegating to the exact same logic the admin endpoints use, so
  // there is only ever one real implementation of each mutation.

  async updateManagementStatusForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
    status: ConversationManagementStatus,
    actorId: string,
  ): Promise<ConversationSummary> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.updateManagementStatus(organizationId, conversationId, status, actorId);
  }

  async updateClassificationForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
    classification: ConversationClassification,
    actorId: string,
  ): Promise<ConversationSummary> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.updateClassification(organizationId, conversationId, classification, actorId);
  }

  async updateAssignmentForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
    assignedExecutiveId: string | null,
    actorId: string,
  ): Promise<ConversationSummary> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.updateAssignment(organizationId, conversationId, assignedExecutiveId, actorId);
  }

  async addTagForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
    tagId: string,
    actorId: string,
  ): Promise<void> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.addTag(organizationId, conversationId, tagId, actorId);
  }

  async removeTagForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
    tagId: string,
    actorId: string,
  ): Promise<void> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.removeTag(organizationId, conversationId, tagId, actorId);
  }

  async listNotesForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
  ): Promise<ConversationNoteSummary[]> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.listNotes(organizationId, conversationId);
  }

  async createNoteForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
    input: CreateConversationNotePayload,
    actorId: string,
  ): Promise<ConversationNoteSummary> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.createNote(organizationId, conversationId, input, actorId);
  }

  async associateManuallyForExecutive(
    organizationId: string,
    userId: string,
    conversationId: string,
    input: { clientId?: string | null; domainId?: string | null; sequenceId?: string | null },
    actorId: string,
  ): Promise<ConversationSummary> {
    await this.requireAccessibleConversation(organizationId, userId, conversationId);
    return this.associateManually(organizationId, conversationId, input, actorId);
  }

  /**
   * `markAsRead` defaults to false — `getById` is also used internally to
   * re-fetch/enrich a conversation right after CREATING it (e.g.
   * `ReplySimulationService`'s controller building its response), and that
   * must never silently clear the very `isUnread: true` the notification
   * system depends on. Only a genuine "the user opened this conversation"
   * entry point (the two controllers below) should pass `true`.
   */
  async getById(
    organizationId: string,
    conversationId: string,
    options: { markAsRead?: boolean; actorId?: string } = {},
  ): Promise<ConversationDetail> {
    let conversation = await this.getOwnedConversation(organizationId, conversationId);
    const [messageRows, noteRows] = await Promise.all([
      this.messages.findByConversation(conversation.id),
      this.notes.findByConversation(conversation.id),
    ]);
    if (options.markAsRead && conversation.isUnread) {
      conversation = await this.conversations.update(conversation.id, { isUnread: false });
      // Keeps the engine's own view of this thread in sync — for a mailbox still on the
      // live-sync path (syncMailbox below), the engine's `fetchInbox` is the source of truth
      // for `unreadCount`; without this, the very next sync sees the engine still reporting
      // the thread unread and flips `isUnread` straight back to true, undoing the read-mark.
      if (options.actorId) {
        try {
          await this.mailboxesService.setThreadReadState(
            organizationId,
            conversation.mailboxId,
            conversation.emailThreadId,
            false,
            options.actorId,
          );
        } catch {
          // Best-effort — an unreachable/misconfigured mailbox must not block marking the
          // conversation read locally; a later successful sync will simply catch up.
        }
      }
    }
    // Fase "Conversaciones persistentes" — the per-user source of truth for
    // read/unread, independent of the coarse `isUnread` flag above: recorded
    // on every genuine "user opened this conversation" call (not on the
    // internal re-fetch-after-create path, same guard as the block above),
    // so a read by one user never marks it read for anyone else.
    if (options.markAsRead && options.actorId) {
      const lastMessage = messageRows[messageRows.length - 1];
      await this.readStates.markRead({
        organizationId,
        conversationId: conversation.id,
        userId: options.actorId,
        lastReadMessageId: lastMessage?.id ?? null,
        lastReadAt: new Date(),
      });
    }
    // options.actorId absent only on the internal "re-fetch right after
    // create" path (see this method's own doc comment) — no user to
    // compute a per-user value for, so toSummary falls back to the legacy
    // coarse flag. Every genuine "user opened this" call has an actorId.
    const unreadForUser = options.actorId
      ? await this.computeUnreadForOne(organizationId, options.actorId, conversation.id)
      : undefined;
    const summary = await this.toSummary(conversation, unreadForUser);
    const notesWithAuthor = await Promise.all(noteRows.map((note) => this.toNoteSummary(note)));

    return {
      ...summary,
      messages: messageRows.map((message): ConversationMessageSummary => ({
        id: message.id,
        direction: message.direction,
        senderEmail: message.senderEmail,
        senderName: message.senderName,
        recipients: message.recipients,
        cc: message.cc,
        subject: message.subject,
        htmlBody: message.htmlBody,
        plainTextBody: message.plainTextBody,
        receivedAt: message.receivedAt,
        sentAt: message.sentAt,
        messageType: message.messageType,
      })),
      notes: notesWithAuthor,
    };
  }

  async updateManagementStatus(
    organizationId: string,
    conversationId: string,
    status: ConversationManagementStatus,
    actorId: string,
  ): Promise<ConversationSummary> {
    const existing = await this.getOwnedConversation(organizationId, conversationId);
    const patch: Parameters<ConversationRepository['update']>[1] = { managementStatus: status };
    if (status === 'RESOLVED') {
      patch.resolvedAt = new Date();
      patch.resolvedBy = actorId;
    }
    if (status === 'ARCHIVED') {
      patch.archivedAt = new Date();
    }
    if (
      existing.managementStatus === 'RESOLVED' &&
      status !== 'RESOLVED' &&
      status !== 'ARCHIVED'
    ) {
      patch.resolvedAt = null;
      patch.resolvedBy = null;
    }

    const updated = await this.conversations.update(existing.id, patch);

    await this.auditLogs.record({
      organizationId,
      actorId,
      action:
        status === 'RESOLVED'
          ? 'conversation.resolve'
          : status === 'ARCHIVED'
            ? 'conversation.archive'
            : existing.managementStatus === 'RESOLVED' || existing.managementStatus === 'ARCHIVED'
              ? 'conversation.reopen'
              : 'conversation.status_change',
      entityType: 'Conversation',
      entityId: conversationId,
      metadata: { from: existing.managementStatus, to: status },
    });

    return this.toSummary(updated, await this.computeUnreadForOne(organizationId, actorId, updated.id));
  }

  async updateClassification(
    organizationId: string,
    conversationId: string,
    classification: ConversationClassification,
    actorId: string,
  ): Promise<ConversationSummary> {
    const existing = await this.getOwnedConversation(organizationId, conversationId);
    const updated = await this.conversations.update(existing.id, { classification });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation.classify',
      entityType: 'Conversation',
      entityId: conversationId,
      metadata: { from: existing.classification, to: classification },
    });

    return this.toSummary(updated, await this.computeUnreadForOne(organizationId, actorId, updated.id));
  }

  async updateAssignment(
    organizationId: string,
    conversationId: string,
    assignedExecutiveId: string | null,
    actorId: string,
  ): Promise<ConversationSummary> {
    const existing = await this.getOwnedConversation(organizationId, conversationId);
    if (assignedExecutiveId) {
      const user = await this.users.findById(assignedExecutiveId);
      if (!user || user.organizationId !== organizationId) {
        throw new NotFoundException('Executive not found.');
      }
    }
    const updated = await this.conversations.update(existing.id, { assignedExecutiveId });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation.assign',
      entityType: 'Conversation',
      entityId: conversationId,
      metadata: { assignedExecutiveId },
    });

    return this.toSummary(updated, await this.computeUnreadForOne(organizationId, actorId, updated.id));
  }

  async associateManually(
    organizationId: string,
    conversationId: string,
    input: { clientId?: string | null; domainId?: string | null; sequenceId?: string | null },
    actorId: string,
  ): Promise<ConversationSummary> {
    const existing = await this.getOwnedConversation(organizationId, conversationId);
    const updated = await this.conversations.update(existing.id, {
      clientId: input.clientId,
      domainId: input.domainId,
      sequenceId: input.sequenceId,
    });

    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation.manual_associate',
      entityType: 'Conversation',
      entityId: conversationId,
      metadata: input,
    });

    return this.toSummary(updated, await this.computeUnreadForOne(organizationId, actorId, updated.id));
  }

  async addTag(
    organizationId: string,
    conversationId: string,
    tagId: string,
    actorId: string,
  ): Promise<void> {
    await this.getOwnedConversation(organizationId, conversationId);
    const tag = await this.tags.findById(tagId);
    if (!tag || tag.organizationId !== organizationId) {
      throw new NotFoundException('Tag not found.');
    }
    await this.conversations.addTag(conversationId, tagId, actorId);
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation.tag_apply',
      entityType: 'Conversation',
      entityId: conversationId,
      metadata: { tagId },
    });
  }

  async removeTag(
    organizationId: string,
    conversationId: string,
    tagId: string,
    actorId: string,
  ): Promise<void> {
    await this.getOwnedConversation(organizationId, conversationId);
    await this.conversations.removeTag(conversationId, tagId);
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation.tag_remove',
      entityType: 'Conversation',
      entityId: conversationId,
      metadata: { tagId },
    });
  }

  async listTags(organizationId: string): Promise<ConversationTagSummary[]> {
    const rows = await this.tags.findAll(organizationId);
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      color: row.color,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async createTag(
    organizationId: string,
    input: CreateConversationTagPayload,
    actorId: string,
  ): Promise<ConversationTagSummary> {
    const tag = await this.tags.create({
      organizationId,
      name: input.name,
      color: input.color,
      createdBy: actorId,
    });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation_tag.create',
      entityType: 'ConversationTag',
      entityId: tag.id,
      metadata: { name: tag.name },
    });
    return {
      id: tag.id,
      organizationId: tag.organizationId,
      name: tag.name,
      color: tag.color,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    };
  }

  async updateTag(
    organizationId: string,
    tagId: string,
    input: UpdateConversationTagPayload,
    actorId: string,
  ): Promise<ConversationTagSummary> {
    const existing = await this.tags.findById(tagId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException('Tag not found.');
    }
    const updated = await this.tags.update(tagId, { name: input.name, color: input.color });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation_tag.update',
      entityType: 'ConversationTag',
      entityId: tagId,
    });
    return {
      id: updated.id,
      organizationId: updated.organizationId,
      name: updated.name,
      color: updated.color,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteTag(organizationId: string, tagId: string, actorId: string): Promise<void> {
    const existing = await this.tags.findById(tagId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException('Tag not found.');
    }
    await this.tags.update(tagId, { deletedAt: new Date() });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation_tag.delete',
      entityType: 'ConversationTag',
      entityId: tagId,
    });
  }

  async listNotes(
    organizationId: string,
    conversationId: string,
  ): Promise<ConversationNoteSummary[]> {
    await this.getOwnedConversation(organizationId, conversationId);
    const rows = await this.notes.findByConversation(conversationId);
    return Promise.all(rows.map((row) => this.toNoteSummary(row)));
  }

  async createNote(
    organizationId: string,
    conversationId: string,
    input: CreateConversationNotePayload,
    actorId: string,
  ): Promise<ConversationNoteSummary> {
    await this.getOwnedConversation(organizationId, conversationId);
    const note = await this.notes.create({
      organizationId,
      conversationId,
      authorUserId: actorId,
      content: input.content,
    });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation_note.create',
      entityType: 'ConversationNote',
      entityId: note.id,
      metadata: { conversationId },
    });
    return this.toNoteSummary(note);
  }

  async updateNote(
    organizationId: string,
    noteId: string,
    input: UpdateConversationNotePayload,
    actorId: string,
  ): Promise<ConversationNoteSummary> {
    const existing = await this.notes.findById(noteId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException('Note not found.');
    }
    const updated = await this.notes.update(noteId, { content: input.content });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation_note.update',
      entityType: 'ConversationNote',
      entityId: noteId,
    });
    return this.toNoteSummary(updated);
  }

  async deleteNote(organizationId: string, noteId: string, actorId: string): Promise<void> {
    const existing = await this.notes.findById(noteId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException('Note not found.');
    }
    await this.notes.update(noteId, { deletedAt: new Date() });
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'conversation_note.delete',
      entityType: 'ConversationNote',
      entityId: noteId,
    });
  }

  async updateNoteForExecutive(
    organizationId: string,
    userId: string,
    noteId: string,
    input: UpdateConversationNotePayload,
    actorId: string,
  ): Promise<ConversationNoteSummary> {
    const note = await this.notes.findById(noteId);
    if (!note || note.organizationId !== organizationId) {
      throw new NotFoundException('Note not found.');
    }
    await this.requireAccessibleConversation(organizationId, userId, note.conversationId);
    return this.updateNote(organizationId, noteId, input, actorId);
  }

  async deleteNoteForExecutive(
    organizationId: string,
    userId: string,
    noteId: string,
    actorId: string,
  ): Promise<void> {
    const note = await this.notes.findById(noteId);
    if (!note || note.organizationId !== organizationId) {
      throw new NotFoundException('Note not found.');
    }
    await this.requireAccessibleConversation(organizationId, userId, note.conversationId);
    return this.deleteNote(organizationId, noteId, actorId);
  }

  /** Same 404-not-403 rule as every other resource in this API. */
  private async getOwnedConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation || conversation.organizationId !== organizationId) {
      throw new NotFoundException('Conversation not found.');
    }
    return conversation;
  }

  /**
   * Practical simplification of §14's 8-step Message-ID/In-Reply-To/
   * References priority chain: the mock engine's demo threads carry none
   * of those headers (there is no real message store behind them — see
   * README). The one signal that IS real is "which sequence, if any,
   * sends from this exact mailbox" (`Sequence.mailboxId`), so that's what
   * this resolves — and only when it's unambiguous (exactly one
   * DRAFT/PAUSED sequence on the mailbox). Multiple or zero candidates
   * leave the conversation unassociated to a sequence rather than
   * guessing, consistent with §14's "no asociar automáticamente cuando
   * exista ambigüedad significativa."
   */
  private async findCandidateSequence(
    organizationId: string,
    mailbox: Mailbox,
  ): Promise<Sequence | null> {
    if (!mailbox.clientId) return null;
    const clientSequences = await this.sequences.findByClient(organizationId, mailbox.clientId);
    const onThisMailbox = clientSequences.filter(
      (sequence) => sequence.mailboxId === mailbox.id && sequence.status !== 'ARCHIVED',
    );
    return onThisMailbox.length === 1 ? onThisMailbox[0] : null;
  }

  private async syncMessages(
    organizationId: string,
    mailbox: Mailbox,
    conversation: Conversation,
    threadId: string,
    classification: ReturnType<typeof classifyInboundMessage>,
  ): Promise<void> {
    const thread = await this.mailboxesService.getThread(organizationId, mailbox.id, threadId);
    if (thread.status !== 'OK') return;

    for (const message of thread.messages) {
      const already = await this.messages.findByEmailMessageId(conversation.id, message.id);
      if (already) continue;

      await this.messages.create({
        organizationId,
        conversationId: conversation.id,
        mailboxId: mailbox.id,
        emailMessageId: message.id,
        direction: message.direction,
        senderEmail: message.from.email,
        senderName: message.from.name,
        recipients: message.to.map((recipient) => recipient.email),
        subject: message.subject,
        htmlBody: message.bodyHtml,
        plainTextBody: message.bodyText,
        receivedAt: message.direction === 'INBOUND' ? new Date(message.receivedAt) : null,
        sentAt: message.direction === 'OUTBOUND' ? new Date(message.receivedAt) : null,
        messageType:
          message.direction === 'OUTBOUND' ? 'OUTREACH_EMAIL' : classification.messageType,
      });
    }
  }

  /**
   * Reuses SequencesService.pause() — the same, already-real pause
   * mechanism a human triggers manually from the UI. §23's "cancelar
   * jobs programados" has nothing to cancel (there is no scheduler/worker
   * anywhere in this codebase — see README), so pausing the sequence
   * itself, which prevents any future step from ever being sent through
   * the normal create/edit/send-test flow, is the whole of what "stopping"
   * means in this phase.
   */
  private async autoStopSequence(
    organizationId: string,
    sequence: Sequence,
    conversationId: string,
    classification: ConversationClassification,
    actorId: string,
  ): Promise<void> {
    await this.sequencesService.pause(organizationId, sequence.id, actorId);
    await this.auditLogs.record({
      organizationId,
      actorId,
      action: 'sequence.auto_pause',
      entityType: 'Sequence',
      entityId: sequence.id,
      metadata: { reason: classification, conversationId },
    });
  }

  /**
   * Fase "Estado leído/no leído por usuario" — batches the two lookups
   * (`findLastInboundForConversations`, `findAllForUser`) once for an
   * entire list rather than once per row, then applies the pure
   * `isConversationUnreadForUser` policy per conversation. This is the
   * ONLY place `ConversationSummary.isUnread` should ever be computed
   * from for a genuine "current user" — never `conversation.isUnread`
   * (see that field's own doc comment: legacy/coarse, non-authoritative).
   */
  private async computeUnreadMap(
    organizationId: string,
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, boolean>> {
    if (conversationIds.length === 0) return new Map();
    const [lastInboundByConversation, readStates] = await Promise.all([
      this.messages.findLastInboundForConversations(conversationIds),
      this.readStates.findAllForUser(organizationId, userId, conversationIds),
    ]);
    const readStateByConversation = new Map(readStates.map((state) => [state.conversationId, state]));
    const result = new Map<string, boolean>();
    for (const conversationId of conversationIds) {
      result.set(
        conversationId,
        isConversationUnreadForUser(
          lastInboundByConversation.get(conversationId) ?? null,
          readStateByConversation.get(conversationId) ?? null,
        ),
      );
    }
    return result;
  }

  private async computeUnreadForOne(organizationId: string, userId: string, conversationId: string): Promise<boolean> {
    const map = await this.computeUnreadMap(organizationId, userId, [conversationId]);
    return map.get(conversationId) ?? false;
  }

  private async toSummary(conversation: Conversation, unreadForUser?: boolean): Promise<ConversationSummary> {
    const [mailbox, client, domain, sequence, executive, tagIds, company, originatingStep, enrolledContact] =
      await Promise.all([
        this.mailboxes.findById(conversation.mailboxId),
        conversation.clientId ? this.clients.findById(conversation.clientId) : null,
        conversation.domainId ? this.domains.findById(conversation.domainId) : null,
        conversation.sequenceId ? this.sequences.findById(conversation.sequenceId) : null,
        conversation.assignedExecutiveId
          ? this.users.findById(conversation.assignedExecutiveId)
          : null,
        this.conversations.listTagIds(conversation.id),
        conversation.companyId ? this.companies.findById(conversation.companyId) : null,
        this.resolveOriginatingStep(conversation.originatingScheduledEmailId),
        conversation.sequenceContactId ? this.sequenceContacts.findById(conversation.sequenceContactId) : null,
      ]);

    return {
      id: conversation.id,
      organizationId: conversation.organizationId,
      clientId: conversation.clientId,
      clientName: client?.name ?? null,
      domainId: conversation.domainId,
      domainName: domain?.domainName ?? null,
      mailboxId: conversation.mailboxId,
      mailboxEmail: mailbox?.email ?? '',
      contactEmail: conversation.contactEmail,
      contactName: conversation.contactName,
      contactId: conversation.contactId,
      companyId: conversation.companyId,
      companyName: company?.rawName ?? null,
      sequenceId: conversation.sequenceId,
      sequenceName: sequence?.name ?? null,
      sequenceStepId: conversation.sequenceStepId,
      originatingStepName: originatingStep?.name ?? null,
      originatingStepPosition: originatingStep?.position ?? null,
      contactStatus: enrolledContact?.status ?? null,
      responseOutcome: conversation.responseOutcome,
      assignedExecutiveId: conversation.assignedExecutiveId,
      assignedExecutiveName: executive ? fullName(executive) : null,
      subject: conversation.subject,
      managementStatus: conversation.managementStatus,
      classification: conversation.classification,
      // Legacy fallback (conversation.isUnread) only for the rare internal
      // caller that has no "current user" to compute against — every
      // controller-facing call site below passes the real per-user value.
      isUnread: unreadForUser ?? conversation.isUnread,
      lastMessageAt: conversation.lastMessageAt,
      resolvedAt: conversation.resolvedAt,
      archivedAt: conversation.archivedAt,
      tagIds,
      isUnmatched: !mailbox?.clientId,
      isSimulation: conversation.isSimulation,
      simulationScenario: conversation.simulationScenario,
      createdAt: conversation.createdAt,
    };
  }

  /** §34 — "originada desde: Step N — Envío N", resolved through the exact ScheduledEmail this reply was attributed to. */
  private async resolveOriginatingStep(
    scheduledEmailId: string | null,
  ): Promise<{ name: string; position: number } | null> {
    if (!scheduledEmailId) return null;
    const scheduledEmail = await this.scheduledEmails.findById(scheduledEmailId);
    if (!scheduledEmail) return null;
    const step = await this.sequenceSteps.findById(scheduledEmail.sequenceStepId);
    if (!step) return null;
    return { name: step.name, position: step.position };
  }

  private async toNoteSummary(note: {
    id: string;
    authorUserId: string;
    content: string;
    responseOutcome: ResponseOutcome | null;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<ConversationNoteSummary> {
    const author = await this.users.findById(note.authorUserId);
    return {
      id: note.id,
      authorUserId: note.authorUserId,
      authorName: author ? fullName(author) : 'Usuario eliminado',
      content: note.content,
      responseOutcome: note.responseOutcome,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  }
}
