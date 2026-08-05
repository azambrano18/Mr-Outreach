import { ProspectExecutionState } from '../../domain/prospect-import/prospect-import-row.entity';
import { SequenceExecutionServerStatus, SequenceExecutionStatus } from '../../domain/sequence-execution/sequence-execution.entity';

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
  /** §5 — null until "Iniciar gestión" actually sends the command; the frontend shows "Borrador de gestión" in the meantime. */
  name: string | null;
  timezone: string;
  status: SequenceExecutionStatus;
  /** §5 — real submission-lifecycle instants; never a manually-picked date, never sent to the server. */
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
  /** §2 — the server's own initial per-prospect state on acceptance (contractually STEP_01_PENDING); never an instruction Mr Outreach sent. */
  initialProspectState: ProspectExecutionState | null;
  prospectCount: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  serverExecutionId: string | null;
  /** Fase "Control operativo de Gestiones" — set once, on the first successful pause/resume/stop; never cleared. */
  pausedAt: string | null;
  resumedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  /** Fase "Reiniciar Gestión" — 1 for an original execution, N for its Nth restart attempt. */
  executionAttempt: number;
  /** Set only on a restart attempt — the STOPPED execution it was restarted from. */
  previousExecutionId: string | null;
  createdAt: string;
  updatedAt: string;
}
