import { ProspectExecutionState } from '../prospect-import/prospect-import-row.entity';

/**
 * §11 — local editing/submission lifecycle. There is deliberately no
 * "SCHEDULED" status: the executive never picks a start date/time, so
 * there is nothing to "schedule" locally. SUBMISSION_UNKNOWN is a distinct
 * state from SUBMITTING: it means the motor call itself failed to
 * complete (timeout/unreachable) and Mr Outreach genuinely does not know
 * whether the server received it — never silently treated as SUBMITTING
 * nor reverted to DRAFT (§12). ACCEPTED is the outcome of a successful
 * submission — the server may separately report an internal QUEUED
 * status later (surfaced via `serverStatus`), but that is the server's
 * own business, never a decision Mr Outreach made or requested.
 */
export type SequenceExecutionStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'SUBMITTING'
  | 'SUBMISSION_UNKNOWN'
  | 'ACCEPTED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

/** §21 — snapshot of what Railway itself reports, refreshed on demand (never inferred locally). */
export type SequenceExecutionServerStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REJECTED';

/**
 * The Gestión — a concrete run against one immutable SequenceTemplateVersion.
 * Once `status` reaches ACCEPTED, mailboxId/templateVersionId/prospectImportId
 * become immutable (enforced in the use case, not here) — §11.
 */
export interface SequenceExecution {
  id: string;
  organizationId: string;
  executiveId: string;
  mailboxId: string;
  templateId: string;
  templateVersionId: string;
  /** §5 — null while DRAFT; the backend generates "Gestión_DDMMYYYY[_n]" only when the start command is actually sent, from that moment's own calendar date. */
  name: string | null;
  timezone: string;
  status: SequenceExecutionStatus;

  prospectImportId: string | null;

  /**
   * §5 — real submission-lifecycle instants; never a manually-picked date,
   * never sent to the server. `requestedAt` is purely local bookkeeping
   * (when Mr Outreach sent the command); `receivedAt` is the server's own
   * confirmation instant, returned in the accept response.
   */
  requestedAt: Date | null;
  receivedAt: Date | null;
  estimatedStartAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;

  serverStatus: SequenceExecutionServerStatus | null;
  currentStepNumber: number | null;
  sentCount: number | null;
  pendingCount: number | null;
  failedCount: number | null;
  /** §10 — the submission-time prospect counts the server reports back; distinct from sent/pending/failed, which come from later status refreshes. */
  receivedProspects: number | null;
  acceptedProspects: number | null;
  rejectedProspects: number | null;
  /** §2 — the server's own initial per-prospect state on acceptance (contractually STEP_01_PENDING); never an instruction Mr Outreach sent. */
  initialProspectState: ProspectExecutionState | null;
  lastSyncedAt: Date | null;
  lastError: string | null;

  serverExecutionId: string | null;
  /** AES-256-GCM ciphertext via SecretEncryptionService — never the plaintext token, never logged. */
  executionTokenCiphertext: string | null;
  /** §11 — the idempotencyKey used for the most recent /start attempt; reused verbatim on a retry so the motor treats it as the same command instead of creating a duplicate. */
  lastSubmissionIdempotencyKey: string | null;

  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSequenceExecutionInput {
  organizationId: string;
  executiveId: string;
  mailboxId: string;
  templateId: string;
  templateVersionId: string;
  timezone: string;
  createdBy: string;
}

export interface UpdateSequenceExecutionInput {
  status?: SequenceExecutionStatus;
  /** §12 — editable only while DRAFT; enforced in SequenceExecutionsService, not here. */
  mailboxId?: string;
  templateId?: string;
  templateVersionId?: string;
  name?: string | null;
  timezone?: string;
  prospectImportId?: string | null;
  requestedAt?: Date | null;
  receivedAt?: Date | null;
  estimatedStartAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  serverStatus?: SequenceExecutionServerStatus | null;
  currentStepNumber?: number | null;
  sentCount?: number | null;
  pendingCount?: number | null;
  failedCount?: number | null;
  receivedProspects?: number | null;
  acceptedProspects?: number | null;
  rejectedProspects?: number | null;
  initialProspectState?: ProspectExecutionState | null;
  lastSyncedAt?: Date | null;
  lastError?: string | null;
  serverExecutionId?: string | null;
  executionTokenCiphertext?: string | null;
  lastSubmissionIdempotencyKey?: string | null;
}
