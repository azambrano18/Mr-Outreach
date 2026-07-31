export type ConversationManagementStatus =
  'NEW' | 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';

export type ConversationClassification =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'REQUESTS_INFORMATION'
  | 'FOLLOW_UP_LATER'
  | 'WRONG_CONTACT'
  | 'OUT_OF_OFFICE'
  | 'AUTOMATIC_REPLY'
  | 'HARD_BOUNCE'
  | 'SOFT_BOUNCE'
  | 'UNSUBSCRIBE'
  | 'UNCLASSIFIED';

/**
 * The executive's deliberate business decision about a reply, distinct from
 * `ConversationClassification` (auto-detected from message content/headers).
 * Drives real side effects on the sequence — see `ResponseOutcomeService`:
 * `NOT_INTERESTED`/`INTERESTED` stop the whole company's participation in
 * this sequence, `DO_NOT_CONTACT` excludes only this one contact, `REFERRED`
 * swaps this contact out for a new one within the same company/sequence.
 */
export type ResponseOutcome = 'NOT_INTERESTED' | 'DO_NOT_CONTACT' | 'INTERESTED' | 'REFERRED';

/**
 * Which system produced this Conversation — set explicitly at creation,
 * never inferred from which legacy/active foreign keys happen to be
 * non-null. See docs/database-architecture.md.
 */
export type ConversationOrigin = 'ACTIVE_EXECUTION' | 'LEGACY_SEQUENCE' | 'EXTERNAL_INBOUND';

/**
 * Two paths create Conversation rows and both are still current:
 * (1) `ConversationsService.syncMailbox()`, the Fase 11 on-demand
 * IMAP-thread pull — no real `Contact` row backs those (the engine returns
 * bare participant email/name), so `contactId`/`companyId` stay null and
 * the contact stays denormalized (`contactEmail`/`contactName`), same as
 * before. (2) `ReplySimulationService`, this phase's simulated-reply flow —
 * those rows DO originate from a real imported `Contact`/`Company`/
 * `SequenceContact`, so the id fields are populated and give exact
 * traceability to the step/send that provoked the reply (§34).
 */
export interface Conversation {
  id: string;
  organizationId: string;
  clientId: string | null;
  domainId: string | null;
  mailboxId: string;
  /** The engine's thread id (`InboxThreadResult.id`) for path (1); a synthetic `sim-thread-*` id for path (2) — both are how sync/simulation find the row again idempotently. */
  emailThreadId: string;
  contactEmail: string;
  contactName: string | null;
  /** Fallback for when no companyId is resolved yet — never overwritten once a real Company exists. */
  companyNameSnapshot: string | null;
  /** Set only by path (2) — see class comment. */
  contactId: string | null;
  companyId: string | null;
  /** Which flow created this row — see ConversationOrigin. */
  origin: ConversationOrigin;
  sequenceContactId: string | null;
  /** The exact ScheduledEmail (step + send) this reply is attributed to — §34's "originada desde Step N". */
  originatingScheduledEmailId: string | null;
  sequenceId: string | null;
  sequenceStepId: string | null;
  /** Active-flow attribution (Plantillas/Gestiones) — populated instead of the legacy fields above for ACTIVE_EXECUTION conversations. */
  sequenceExecutionId: string | null;
  prospectImportRowId: string | null;
  assignedExecutiveId: string | null;
  subject: string;
  managementStatus: ConversationManagementStatus;
  classification: ConversationClassification;
  responseOutcome: ResponseOutcome | null;
  isUnread: boolean;
  lastMessageAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateConversationInput {
  organizationId: string;
  clientId: string | null;
  domainId: string | null;
  mailboxId: string;
  emailThreadId: string;
  contactEmail: string;
  contactName: string | null;
  companyNameSnapshot?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  /** Required — every creation call site must state explicitly which flow produced this row. */
  origin: ConversationOrigin;
  sequenceContactId?: string | null;
  originatingScheduledEmailId?: string | null;
  sequenceId?: string | null;
  sequenceStepId?: string | null;
  sequenceExecutionId?: string | null;
  prospectImportRowId?: string | null;
  assignedExecutiveId?: string | null;
  subject: string;
  classification?: ConversationClassification;
  isUnread: boolean;
  lastMessageAt: Date;
}

export interface UpdateConversationInput {
  clientId?: string | null;
  domainId?: string | null;
  sequenceId?: string | null;
  sequenceStepId?: string | null;
  sequenceExecutionId?: string | null;
  prospectImportRowId?: string | null;
  /** Links a previously-unmatched EXTERNAL_INBOUND conversation to a real Contact/Company after the fact — never clears an existing value back to null. */
  contactId?: string | null;
  companyId?: string | null;
  companyNameSnapshot?: string | null;
  assignedExecutiveId?: string | null;
  managementStatus?: ConversationManagementStatus;
  classification?: ConversationClassification;
  responseOutcome?: ResponseOutcome | null;
  isUnread?: boolean;
  lastMessageAt?: Date;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  archivedAt?: Date | null;
  deletedAt?: Date | null;
}
