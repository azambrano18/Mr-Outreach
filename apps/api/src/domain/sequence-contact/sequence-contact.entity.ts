/**
 * §26, plus `COMPLETED_MANUALLY` — an executive ending a prospect's
 * participation deliberately (e.g. "ya mostró interés, seguimos la gestión
 * fuera de la secuencia") from the conversation's own 3-dot menu. Kept
 * distinct from `COMPLETED` (which means "went through every step
 * naturally") so the two are never confused in reporting/traceability.
 */
export type SequenceContactStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SCHEDULED'
  | 'REPLIED'
  | 'BOUNCED'
  | 'UNSUBSCRIBED'
  | 'COMPLETED'
  | 'COMPLETED_MANUALLY'
  | 'PAUSED'
  | 'REMOVED'
  | 'ERROR';

export interface SequenceContact {
  id: string;
  organizationId: string;
  clientId: string;
  sequenceId: string;
  sequenceVersion: number;
  contactId: string;
  companyId: string | null;
  /** Fase 1 — traceability back to the import that enrolled this contact, when there was one (minimal, justified port extension). */
  sourceImportId: string | null;
  assignedMailboxId: string;
  assignedExecutiveId: string;
  currentStepId: string | null;
  currentStepPosition: number | null;
  status: SequenceContactStatus;
  nextScheduledAt: Date | null;
  startedAt: Date;
  lastSentAt: Date | null;
  repliedAt: Date | null;
  completedAt: Date | null;
  stoppedAt: Date | null;
  stopReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSequenceContactInput {
  organizationId: string;
  clientId: string;
  sequenceId: string;
  sequenceVersion: number;
  contactId: string;
  companyId: string | null;
  sourceImportId?: string | null;
  assignedMailboxId: string;
  assignedExecutiveId: string;
  currentStepId: string;
  currentStepPosition: number;
}

export interface UpdateSequenceContactInput {
  currentStepId?: string | null;
  currentStepPosition?: number | null;
  status?: SequenceContactStatus;
  nextScheduledAt?: Date | null;
  lastSentAt?: Date | null;
  repliedAt?: Date | null;
  completedAt?: Date | null;
  stoppedAt?: Date | null;
  stopReason?: string | null;
}
