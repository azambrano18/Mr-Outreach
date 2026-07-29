/**
 * §10-13 — the shapes `SequenceTemplateMotorPort` and both its adapters
 * speak. Mirrors the mailbox-motor split: this is a DIFFERENT external
 * concern from `MailboxMotorPort` (account linking) — publishing a
 * Plantilla's content/schedule, not registering an account.
 *
 * Never carries IMAP/SMTP credentials, API keys, cookies or session
 * tokens — only the template's own logical content (see
 * PublishSequenceTemplateUseCase's payload builder).
 */

export type SequenceTemplateDelayReference = 'EXECUTION_START' | 'PREVIOUS_STEP';
export type SequenceTemplateDelayUnit = 'MINUTES' | 'HOURS' | 'CALENDAR_DAYS' | 'BUSINESS_DAYS';
export type SequenceTemplateWeekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

/** §4/§5/§7 — one "envío"; subject is shared and lives on `PublishSequenceTemplateInput` instead, but the header is individual per envío again. */
export interface SequenceTemplateMotorStepInput {
  stepNumber: 1 | 2 | 3;
  /** §4 (revised) — optional, individual per envío; the motor/HTML preview wraps it in a single <p>. */
  headerText: string | null;
  bodyHtml: string;
  bodyText: string;
  schedule: {
    delayValue: number;
    delayUnit: SequenceTemplateDelayUnit;
    delayReference: SequenceTemplateDelayReference;
    allowedWeekdays: SequenceTemplateWeekday[];
    sendWindowStart: string;
    sendWindowEnd: string;
  };
}

export interface PublishSequenceTemplateInput {
  idempotencyKey: string;
  correlationId: string;
  organizationId: string;
  executiveUserId: string;
  localTemplateId: string;
  serverMailboxId: string;
  mailboxEmail: string;
  name: string;
  version: number;
  timezone: string;
  /** §5 — shared across the 3 envíos. */
  subjectTemplate: string;
  signatureHtml: string;
  variables: Array<{ key: string; required: boolean }>;
  steps: SequenceTemplateMotorStepInput[];
}

export type SequenceTemplatePublishStatus = 'ACCEPTED' | 'FAILED';

/** Never thrown for a well-formed request — ACCEPTED/FAILED are both legitimate business outcomes, distinct from a transport-level failure (ServiceUnavailableException). */
export interface PublishSequenceTemplateResult {
  accepted: boolean;
  serverTemplateId: string | null;
  /** Kept in memory only by the caller until encrypted — see SequenceTemplateMotorPort's doc comment. */
  templateToken: string | null;
  version: number;
  status: SequenceTemplatePublishStatus;
  acceptedAt: Date | null;
  rejectionReason: string | null;
}

export interface SequenceTemplateStatusSnapshot {
  serverTemplateId: string;
  status: SequenceTemplatePublishStatus;
  checkedAt: Date;
}

/**
 * §12-17 — a distinct command from `publishTemplate`: this one updates an
 * ALREADY-published template (the server already has `serverTemplateId`/
 * `currentVersion`). Railway must apply it only to future, not-yet-executed
 * jobs (`effectiveScope`) — already-sent envíos and in-flight jobs keep the
 * previous version untouched.
 */
export interface UpdateSequenceTemplateInput {
  idempotencyKey: string;
  correlationId: string;
  organizationId: string;
  executiveUserId: string;
  localTemplateId: string;
  serverTemplateId: string;
  serverMailboxId: string;
  mailboxEmail: string;
  name: string;
  currentVersion: number;
  newVersion: number;
  timezone: string;
  subjectTemplate: string;
  signatureHtml: string;
  variables: Array<{ key: string; required: boolean }>;
  steps: SequenceTemplateMotorStepInput[];
  effectiveScope: 'FUTURE_UNSENT_JOBS';
}

export type SequenceTemplateUpdateStatus = 'APPLIED' | 'FAILED';

/** Never thrown for a well-formed request — APPLIED/FAILED are both legitimate business outcomes. The affected/unchanged job counts are authoritative only once `accepted` — Railway is the only party that actually knows its own job queue. */
export interface UpdateSequenceTemplateResult {
  accepted: boolean;
  serverTemplateId: string | null;
  previousVersion: number;
  newVersion: number;
  /** Kept in memory only by the caller until encrypted. */
  templateToken: string | null;
  status: SequenceTemplateUpdateStatus;
  effectiveScope: 'FUTURE_UNSENT_JOBS';
  affectedExecutions: number | null;
  affectedPendingJobs: number | null;
  unchangedSentJobs: number | null;
  processingJobsNotChanged: number | null;
  appliedAt: Date | null;
  rejectionReason: string | null;
}
