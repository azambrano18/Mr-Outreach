export type SequenceTemplateStatus = 'DRAFT' | 'PUBLISHING' | 'PUBLISHED' | 'PUBLISH_FAILED' | 'ARCHIVED';
export type DelayUnit = 'MINUTES' | 'HOURS' | 'CALENDAR_DAYS' | 'BUSINESS_DAYS';
export type DelayReference = 'EXECUTION_START' | 'PREVIOUS_STEP';
export type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

/** One "envío" — each has its own optional header again (§4, revised); schedule is fixed and non-editable (§1-3). */
export interface SequenceTemplateStepSummary {
  id: string;
  stepNumber: 1 | 2 | 3;
  headerText: string | null;
  bodyHtml: string;
  bodyText: string;
  delayValue: number;
  delayUnit: DelayUnit;
  delayReference: DelayReference;
  allowedWeekdays: Weekday[];
  sendWindowStart: string;
  sendWindowEnd: string;
  scheduleDescription: string;
}

export interface SequenceTemplateVersionSummary {
  id: string;
  versionNumber: number;
  status: 'REQUESTED' | 'ACCEPTED' | 'FAILED';
  templateTokenMasked: string | null;
  serverTemplateId: string | null;
  acceptedAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** §12-17 — populated only when this version came from "Editar plantilla publicada"; null for a first publish. */
  previousVersionNumber: number | null;
  effectiveScope: 'FUTURE_UNSENT_JOBS' | null;
  affectedExecutions: number | null;
  affectedPendingJobs: number | null;
  unchangedSentJobs: number | null;
  processingJobsNotChanged: number | null;
  appliedAt: string | null;
}

export interface SequenceTemplateSummary {
  id: string;
  organizationId: string;
  ownerUserId: string;
  mailboxId: string;
  mailboxEmail: string;
  clientName: string | null;
  domainName: string | null;
  /** §1 (Fase 1.7) — required, executive-chosen; identical across every version. */
  name: string;
  description: string | null;
  /** §5 — shared across the 3 envíos. */
  subjectTemplate: string;
  status: SequenceTemplateStatus;
  currentDraftVersion: number;
  timezone: string;
  latestPublishedVersion: SequenceTemplateVersionSummary | null;
  /** §10/§12 (Fase 1.7) — Gestiones the server may still be acting on; 0 unless PUBLISHED. */
  activeExecutionsCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface SequenceTemplateDetail extends SequenceTemplateSummary {
  steps: SequenceTemplateStepSummary[];
  variablesUsed: string[];
  versions: SequenceTemplateVersionSummary[];
  signatureHtml: string;
}

export interface TemplatePublishValidation {
  valid: boolean;
  errors: string[];
}
