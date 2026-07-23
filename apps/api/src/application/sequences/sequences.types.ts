import {
  SequencePolicies,
  SequencePublishStatus,
  SequenceSchedule,
  SequenceStatus,
  SequenceStepPolicy,
} from '../../domain/sequence/sequence.entity';

export interface SequenceSummary {
  id: string;
  organizationId: string;
  executiveId: string;
  /** Who configured/published the sequence — distinct from `executiveId` (who operationally owns it) whenever an admin created it on an executive's behalf. */
  createdBy: string;
  mailboxId: string | null;
  mailboxEmail: string | null;
  name: string;
  description: string | null;
  status: SequenceStatus;
  timezone: string;
  schedule: SequenceSchedule;
  policies: SequencePolicies;
  managementDate: string | null;
  stepPolicy: SequenceStepPolicy;
  publishStatus: SequencePublishStatus | null;
  effectiveStartAt: Date | null;
  sequenceVersion: number;
  lastPublishedAt: Date | null;
  lastPublishCommandId: string | null;
  stepCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSequencePayload {
  name: string;
  description?: string;
  timezone: string;
}

/** §5 — the wizard's "Configuración general" step: client + sender account + management date, all at once. */
export interface CreateWizardSequencePayload {
  clientId: string;
  mailboxId: string;
  managementDate: string;
}

/**
 * Admin equivalent of CreateWizardSequencePayload, used when the actor is
 * NOT the executive the sequence will belong to — per spec, the mailbox
 * must already be assigned to the target executive UNLESS the admin
 * explicitly authorizes the assignment as part of this same call.
 */
export interface CreateWizardSequenceForExecutivePayload extends CreateWizardSequencePayload {
  /** Spec §1.1 paso 2 — must be an ACTIVE domain belonging to `clientId`, and the mailbox must belong to it. */
  domainId: string;
  authorizeMailboxAssignment?: boolean;
}

export interface ReassignExecutivePayload {
  executiveId: string;
  reason?: string;
}

export interface UpdateSequencePayload {
  name?: string;
  description?: string | null;
  timezone?: string;
  mailboxId?: string | null;
  schedule?: SequenceSchedule;
}

export interface SenderAccountInfo {
  mailboxId: string;
  email: string;
  fromName: string;
  dailyLimit: number | null;
  hasActiveSignature: boolean;
  signatureLabel: string | null;
  operational: boolean;
  issues: string[];
}

export interface ReadinessCheck {
  ok: boolean;
  issues: string[];
}

export interface PendingFeatureCheck {
  status: 'PENDING_FEATURE';
  message: string;
}

export interface SequenceReadiness {
  account: ReadinessCheck;
  steps: ReadinessCheck;
  prospects: PendingFeatureCheck;
  calendar: PendingFeatureCheck;
  /** True only when every check this phase can actually perform passes — prospects/calendar are excluded (not built yet). */
  overallReady: boolean;
}

export interface SchedulePreviewStep {
  stepId: string;
  position: number;
  name: string;
  /** ISO instant — informational only; the real send depends on when the previous step actually goes out. */
  estimatedAt: string;
}

/** §7 — "Envío estimado" per step, recalculated live from the sequence's current management date/window/delays. */
export interface SchedulePreview {
  effectiveStartAt: string;
  steps: SchedulePreviewStep[];
}

export interface SequenceDeletionResult {
  id: string;
  deletedAt: string;
  previousStatus: SequenceStatus;
  /**
   * Always 0 in this phase — there is no scheduler/worker yet (see
   * README > "Fase 10"), so there is nothing real to cancel. Kept as a
   * field so the response shape doesn't need to change once one exists.
   */
  cancelledJobs: number;
}
