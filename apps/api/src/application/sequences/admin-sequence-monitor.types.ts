import { SequencePublishStatus, SequenceStatus } from '../../domain/sequence/sequence.entity';

/** Spec §4.2 — every filter the global monitoring panel supports, all optional/combinable. */
export interface AdminSequenceListFilter {
  executiveId?: string;
  clientId?: string;
  mailboxId?: string;
  status?: SequenceStatus;
  /** true = status !== ARCHIVED ("activas"), false = status === ARCHIVED ("finalizadas"). Omit for both. */
  activeOnly?: boolean;
  createdFrom?: string;
  createdTo?: string;
  startedFrom?: string;
  startedTo?: string;
  /** Matches sequence name, client name, executive name or mailbox email (case-insensitive substring). */
  search?: string;
}

/** Spec §4.1 — one row of the global sequences table. */
export interface AdminSequenceListRow {
  id: string;
  name: string;
  status: SequenceStatus;
  publishStatus: SequencePublishStatus | null;
  clientId: string | null;
  clientName: string | null;
  mailboxId: string | null;
  mailboxEmail: string | null;
  executiveId: string;
  executiveName: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  effectiveStartAt: Date | null;
  prospectCount: number;
  sentStep1: number;
  sentStep2: number;
  sentStep3: number;
  repliedCount: number;
  bouncedCount: number;
  stoppedCount: number;
  errorCount: number;
  lastActivityAt: Date | null;
}

export interface AdminSequenceResults {
  prospectCount: number;
  pendingCount: number;
  sentStep1: number;
  sentStep2: number;
  sentStep3: number;
  repliedCount: number;
  bouncedCount: number;
  stoppedCount: number;
  errorCount: number;
}

export interface AdminSequenceEvent {
  at: Date;
  type: string;
  description: string;
}

export interface AdminSequenceStepContent {
  id: string;
  position: number;
  name: string;
  subject: string;
  htmlHeader: string | null;
  htmlBody: string;
  /** True when this reflects an actually-sent (frozen) snapshot rather than the current, possibly-edited draft. */
  isSentSnapshot: boolean;
}

export interface AdminSequenceDetail {
  id: string;
  name: string;
  status: SequenceStatus;
  publishStatus: SequencePublishStatus | null;
  timezone: string;
  managementDate: string | null;
  effectiveStartAt: Date | null;
  createdAt: Date;
  clientId: string | null;
  clientName: string | null;
  mailboxId: string | null;
  mailboxEmail: string | null;
  executiveId: string;
  executiveName: string;
  createdBy: string;
  createdByName: string;
  results: AdminSequenceResults;
  events: AdminSequenceEvent[];
  steps: AdminSequenceStepContent[];
}
