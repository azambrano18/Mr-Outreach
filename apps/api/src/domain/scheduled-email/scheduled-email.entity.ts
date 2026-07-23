/** §24. */
export type ScheduledEmailStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'RETRY_SCHEDULED'
  | 'FAILED'
  | 'CANCELLED';

export type ScheduledEmailPriority = 'FOLLOW_UP' | 'NEW_CONTACT';

/**
 * §25. Uniqueness is `sequenceContactId + sequenceStepId + stepVersion` —
 * enforced by the repository's `create()`, not a DB constraint (same
 * pattern already used for "one PRIMARY per mailbox", see
 * MailboxAssignmentRepository's class comment) — this is what makes
 * re-running the scheduler for an already-scheduled step a no-op instead
 * of a duplicate job.
 */
export interface ScheduledEmail {
  id: string;
  organizationId: string;
  sequenceId: string;
  sequenceVersion: number;
  sequenceContactId: string;
  /** Denormalized from SequenceContact for company-scoped queries (§28's "retirar empresa") without an extra join. */
  contactId: string;
  companyId: string | null;
  sequenceStepId: string;
  stepVersion: number;
  mailboxId: string;
  /** Grouping key only — no separate persisted Batch entity, see BatchesService. */
  batchId: string;
  scheduledAt: Date;
  status: ScheduledEmailStatus;
  priority: ScheduledEmailPriority;
  attemptCount: number;
  idempotencyKey: string;
  lastError: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  /**
   * §31 — populated only once `status` becomes SENT, and never touched
   * again afterwards (a later step/signature/contact edit must never
   * rewrite what was actually sent). §32's Message-ID/threading headers
   * live here too, since this row already IS "the message" once sent.
   */
  sentAt: Date | null;
  subjectSnapshot: string | null;
  htmlBodySnapshot: string | null;
  plainTextBodySnapshot: string | null;
  signatureSnapshot: string | null;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduledEmailInput {
  organizationId: string;
  sequenceId: string;
  sequenceVersion: number;
  sequenceContactId: string;
  contactId: string;
  companyId: string | null;
  sequenceStepId: string;
  stepVersion: number;
  mailboxId: string;
  batchId: string;
  scheduledAt: Date;
  priority: ScheduledEmailPriority;
  idempotencyKey: string;
}

export interface UpdateScheduledEmailInput {
  status?: ScheduledEmailStatus;
  attemptCount?: number;
  lastError?: string | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  sentAt?: Date | null;
  subjectSnapshot?: string | null;
  htmlBodySnapshot?: string | null;
  plainTextBodySnapshot?: string | null;
  signatureSnapshot?: string | null;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string | null;
}
