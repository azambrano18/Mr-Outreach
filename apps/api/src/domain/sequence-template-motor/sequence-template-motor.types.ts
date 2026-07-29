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

/**
 * Consolidación contractual — the ONE publish shape, used identically for a
 * template's first publish (`previousServerTemplateId: null`) and for every
 * later version (`previousServerTemplateId` = the prior ACCEPTED version's
 * own serverTemplateId, purely informational for Railway's own audit trail
 * — never a request to modify anything tied to that previous id). Every
 * call always produces a brand-new, independent `serverTemplateId`; there
 * is no "update in place" variant.
 */
export interface PublishSequenceTemplateInput {
  idempotencyKey: string;
  correlationId: string;
  organizationId: string;
  executiveUserId: string;
  localTemplateId: string;
  /** null for a template's first publish; otherwise the immediately-prior ACCEPTED version's serverTemplateId. */
  previousServerTemplateId: string | null;
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

