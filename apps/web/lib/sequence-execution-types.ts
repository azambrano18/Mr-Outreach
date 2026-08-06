export type SequenceExecutionStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'SUBMITTING'
  | 'SUBMISSION_UNKNOWN'
  | 'ACCEPTED'
  | 'RUNNING'
  | 'PAUSE_REQUESTED'
  | 'PAUSED'
  | 'RESUME_REQUESTED'
  | 'STOP_REQUESTED'
  | 'STOPPED'
  | 'RESTART_REQUESTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

/** The server's own internal status, surfaced verbatim for visibility — QUEUED here is the server's business, never a decision Mr Outreach made or requested. */
export type SequenceExecutionServerStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REJECTED';

/** Server-administered per-prospect lifecycle; Mr Outreach only displays what the server reported. */
export type ProspectExecutionState =
  | 'STEP_01_PENDING'
  | 'STEP_01_PROCESSING'
  | 'STEP_01_SENT'
  | 'STEP_02_PENDING'
  | 'STEP_02_PROCESSING'
  | 'STEP_02_SENT'
  | 'STEP_03_PENDING'
  | 'STEP_03_PROCESSING'
  | 'STEP_03_SENT'
  | 'COMPLETED'
  | 'FAILED';

export interface SequenceExecutionSummary {
  id: string;
  organizationId: string;
  executiveId: string;
  executiveName: string;
  mailboxId: string;
  mailboxEmail: string;
  clientName: string | null;
  domainName: string | null;
  templateId: string;
  templateName: string;
  templateVersionId: string;
  templateVersionNumber: number;
  /** Null until "Iniciar gestión" actually sends the command — show "Borrador de gestión" in the meantime. */
  name: string | null;
  timezone: string;
  status: SequenceExecutionStatus;
  /** Real submission-lifecycle instants; never a manually-picked date, never sent to the server. */
  requestedAt: string | null;
  receivedAt: string | null;
  estimatedStartAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  serverStatus: SequenceExecutionServerStatus | null;
  currentStepNumber: number | null;
  sentCount: number | null;
  pendingCount: number | null;
  failedCount: number | null;
  receivedProspects: number | null;
  acceptedProspects: number | null;
  rejectedProspects: number | null;
  /** The server's own initial per-prospect state on acceptance (contractually STEP_01_PENDING). */
  initialProspectState: ProspectExecutionState | null;
  prospectCount: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  serverExecutionId: string | null;
  /** Set once, on the first successful pause/resume/stop; never cleared. */
  pausedAt: string | null;
  resumedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  /** 1 for an original execution, N for its Nth restart attempt. */
  executionAttempt: number;
  /** Set only on a restart attempt — the STOPPED execution it was restarted from. */
  previousExecutionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Backend-authoritative — computed from CONTROL_TRANSITIONS + the requesting user's permission keys. Always `false` for every field on the executive's own (non-admin) read paths, which never render these buttons. */
  controlCapabilities: SequenceExecutionControlCapabilities;
}

export interface SequenceExecutionControlCapabilities {
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canRestart: boolean;
}

/** Populated by GET /admin/sequence-executions/:id/restart-preview — feeds the restart confirmation modal. */
export interface RestartEligibility {
  executionId: string;
  managementName: string | null;
  mailboxEmail: string;
  templateName: string;
  templateVersionNumber: number;
  totalContacts: number;
  alreadyContactedCount: number;
  eligibleCount: number;
}
