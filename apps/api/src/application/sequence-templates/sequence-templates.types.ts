import { SequenceTemplateStatus } from '../../domain/sequence-template/sequence-template.entity';
import {
  SequenceTemplateStepDelayReference,
  SequenceTemplateStepDelayUnit,
  Weekday,
} from '../../domain/sequence-template/sequence-template-step.entity';

export interface SequenceTemplateStepSummary {
  id: string;
  stepNumber: 1 | 2 | 3;
  /** §4 (revised) — individual, optional header for this one envío; never shared. */
  headerText: string | null;
  bodyHtml: string;
  bodyText: string;
  delayValue: number;
  delayUnit: SequenceTemplateStepDelayUnit;
  delayReference: SequenceTemplateStepDelayReference;
  allowedWeekdays: Weekday[];
  sendWindowStart: string;
  sendWindowEnd: string;
  /** Human-readable rendering of the schedule rule — §2/§3's exact required copy. */
  scheduleDescription: string;
}

export interface SequenceTemplateVersionSummary {
  id: string;
  versionNumber: number;
  status: 'REQUESTED' | 'ACCEPTED' | 'FAILED';
  /** Masked — never the plaintext token (§12). */
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
  name: string;
  description: string | null;
  subjectTemplate: string;
  status: SequenceTemplateStatus;
  currentDraftVersion: number;
  timezone: string;
  latestPublishedVersion: SequenceTemplateVersionSummary | null;
  /** §10/§12 (Fase 1.7) — Gestiones the server may still be acting on; 0 unless PUBLISHED. Drives the "Eliminar" gate and the version-status display. */
  activeExecutionsCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface SequenceTemplateDetail extends SequenceTemplateSummary {
  steps: SequenceTemplateStepSummary[];
  variablesUsed: string[];
  versions: SequenceTemplateVersionSummary[];
  /** Read-only — for the editor's per-envío preview and the publish confirmation modal (§7/§10). Never editable here; see the mailbox's own signature screen. */
  signatureHtml: string;
}
