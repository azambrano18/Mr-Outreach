import { SequenceTemplateStepDelayReference, SequenceTemplateStepDelayUnit, Weekday } from './sequence-template-step.entity';

/** Mirrors the last publish attempt's outcome — REQUESTED is transient (never persisted as a terminal read state, see PublishSequenceTemplateUseCase). */
export type SequenceTemplateVersionStatus = 'REQUESTED' | 'ACCEPTED' | 'FAILED';

/**
 * Frozen envío content, copied at publish time — never re-derived from the
 * (still-mutable) SequenceTemplateStep rows afterward. §4 (revised) — each
 * envío keeps its own optional header again; only the subject stays shared
 * (on the version root).
 */
export interface SequenceTemplateVersionStepSnapshot {
  stepNumber: 1 | 2 | 3;
  headerText: string | null;
  bodyHtml: string;
  bodyText: string;
  delayValue: number;
  delayUnit: SequenceTemplateStepDelayUnit;
  delayReference: SequenceTemplateStepDelayReference;
  allowedWeekdays: Weekday[];
  sendWindowStart: string;
  sendWindowEnd: string;
}

export interface SequenceTemplateVersionVariable {
  key: string;
  required: boolean;
}

/**
 * §5 — one immutable row per publish. Never updated once created (only
 * `status`/`serverTemplateId`/`templateTokenCiphertext`/`acceptedAt`/
 * `lastError`/the update-tracking fields below transition from REQUESTED to
 * a terminal ACCEPTED/FAILED right after the motor call — the content
 * snapshot fields themselves never change). A Gestión started against this
 * version keeps working even if the template later gets a new draft and a
 * new version.
 */
export interface SequenceTemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  /** Snapshots — frozen at publish time, independent of later edits to the mutable template/mailbox/signature. */
  name: string;
  mailboxId: string;
  timezone: string;
  /** §5 — shared across the 3 envíos, frozen at publish time. */
  subjectTemplate: string;
  /** Vestigial — header is per-envío again (see `steps[].headerText`). */
  headerText: string | null;
  signatureHtml: string;
  variables: SequenceTemplateVersionVariable[];
  steps: SequenceTemplateVersionStepSnapshot[];

  status: SequenceTemplateVersionStatus;
  serverTemplateId: string | null;
  /** AES-256-GCM ciphertext via SecretEncryptionService — never the plaintext token, never logged. */
  templateTokenCiphertext: string | null;
  acceptedAt: Date | null;
  lastPublishCommandId: string | null;
  lastError: string | null;

  /** §12-17 — populated only when this version came from "Editar plantilla publicada" (a SEQUENCE_TEMPLATE_UPDATE); null for a template's first publish. */
  previousVersionNumber: number | null;
  effectiveScope: 'FUTURE_UNSENT_JOBS' | null;
  affectedExecutions: number | null;
  affectedPendingJobs: number | null;
  unchangedSentJobs: number | null;
  processingJobsNotChanged: number | null;
  appliedAt: Date | null;

  createdBy: string;
  createdAt: Date;
}

export interface CreateSequenceTemplateVersionInput {
  templateId: string;
  name: string;
  mailboxId: string;
  timezone: string;
  subjectTemplate: string;
  signatureHtml: string;
  variables: SequenceTemplateVersionVariable[];
  steps: SequenceTemplateVersionStepSnapshot[];
  lastPublishCommandId: string;
  createdBy: string;
  /** §12-17 — set only when this create() call is for an update to an already-published template. */
  previousVersionNumber?: number | null;
}

export interface UpdateSequenceTemplateVersionInput {
  status?: SequenceTemplateVersionStatus;
  serverTemplateId?: string | null;
  templateTokenCiphertext?: string | null;
  acceptedAt?: Date | null;
  lastError?: string | null;
  effectiveScope?: 'FUTURE_UNSENT_JOBS' | null;
  affectedExecutions?: number | null;
  affectedPendingJobs?: number | null;
  unchangedSentJobs?: number | null;
  processingJobsNotChanged?: number | null;
  appliedAt?: Date | null;
}
