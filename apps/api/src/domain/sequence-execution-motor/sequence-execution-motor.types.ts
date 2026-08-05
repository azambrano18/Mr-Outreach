import { ProspectExecutionState } from '../prospect-import/prospect-import-row.entity';

/**
 * §18-20 — the shapes `SequenceExecutionMotorPort` and both its adapters
 * speak. A third external concern, distinct from both `MailboxMotorPort`
 * and `SequenceTemplateMotorPort`: starting a concrete Gestión run and
 * reading back its status. Never carries IMAP/SMTP credentials, raw
 * uploaded files, or another execution's data.
 *
 * §3-7 (schema v3.0) — "Mr Outreach solo envía la base asociada al ID de
 * la Plantilla." The command carries nothing beyond `serverTemplateId`
 * and the normalized prospect list: no queue/dispatch/priority/worker
 * instruction, no technical owner, no initial step, no scheduled date.
 * The server resolves the Plantilla, its active version, and the
 * associated mailbox entirely on its own from `serverTemplateId`.
 */

export interface SequenceExecutionMotorProspectInput {
  localProspectId: string;
  email: string;
  variables: Record<string, string>;
}

export interface StartSequenceExecutionInput {
  idempotencyKey: string;
  correlationId: string;
  /** Local-only reference for Mr Outreach's own traceability; never interpreted by the server as an instruction. */
  localExecutionId: string;
  serverTemplateId: string;
  prospects: SequenceExecutionMotorProspectInput[];
}

export type SequenceExecutionSubmitStatus = 'ACCEPTED' | 'REJECTED';

/**
 * Never thrown for a well-formed request — ACCEPTED/REJECTED are both
 * legitimate business outcomes, distinct from a transport-level failure
 * (ServiceUnavailableException). `initialProspectState` is informational
 * only — the fixed contractual rule (every valid prospect starts at
 * STEP_01_PENDING) holds even when the server's response omits this
 * field entirely.
 */
export interface StartSequenceExecutionResult {
  accepted: boolean;
  serverExecutionId: string | null;
  /** Kept in memory only by the caller until encrypted — optional; not every contract needs one for later status queries. */
  executionToken: string | null;
  status: SequenceExecutionSubmitStatus;
  receivedProspects: number;
  acceptedProspects: number;
  rejectedProspects: number;
  initialProspectState: ProspectExecutionState | null;
  /** The server's own confirmation instant — never a date Mr Outreach requested or picked. */
  receivedAt: Date | null;
  rejectionReason: string | null;
}

export type SequenceExecutionServerStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REJECTED';

export interface SequenceExecutionStatusSnapshot {
  serverExecutionId: string;
  status: SequenceExecutionServerStatus;
  currentStepNumber: number | null;
  sentCount: number;
  pendingCount: number;
  failedCount: number;
  estimatedStartAt: Date | null;
  /** Set only once the motor reports the Gestión actually started running. */
  startedAt: Date | null;
  lastError: string | null;
  checkedAt: Date;
}

/**
 * Fase "Control operativo de Gestiones" — the shared input for
 * pause/resume/stop. Idempotent by `idempotencyKey`, same convention as
 * `StartSequenceExecutionInput`. `reason` is only ever populated for stop
 * (an admin-provided, 3-300 character justification); pause/resume never
 * send one.
 */
export interface ExecutionControlCommandInput {
  idempotencyKey: string;
  correlationId: string;
  localExecutionId: string;
  serverExecutionId: string;
  reason?: string | null;
}

export type ExecutionControlOutcome = 'ACCEPTED' | 'REJECTED';

/**
 * Never thrown for a well-formed, reachable request — a business
 * rejection (e.g. the motor's own state disagrees with ours) is
 * `{accepted: false, status: 'REJECTED', ...}`, exactly like
 * `StartSequenceExecutionResult`. Only `ServiceUnavailableException` for
 * an unreachable motor.
 */
export interface ExecutionControlCommandResult {
  accepted: boolean;
  status: ExecutionControlOutcome;
  rejectionReason: string | null;
  /** The motor's own confirmation instant — never a value Mr Outreach picked. */
  acknowledgedAt: Date | null;
}
