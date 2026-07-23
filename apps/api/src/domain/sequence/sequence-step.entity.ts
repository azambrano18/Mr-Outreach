/** BUSINESS_DAYS skips Saturday/Sunday (no holiday calendar yet — see `sequence-timing.util.ts`). */
export type DelayUnit = 'MINUTES' | 'HOURS' | 'DAYS' | 'BUSINESS_DAYS';
export type StepSendMode = 'NEW_THREAD' | 'REPLY';
/**
 * DRAFT: still being written. PUBLISHED: ready to be used once a
 * scheduler exists. DISABLED: skipped for new sends, existing schedules
 * untouched (no scheduler exists yet, so this has no runtime effect
 * today — it's the state a future worker will check). ARCHIVED: retired.
 */
export type SequenceStepStatus = 'DRAFT' | 'PUBLISHED' | 'DISABLED' | 'ARCHIVED';

export interface SequenceStep {
  id: string;
  organizationId: string;
  sequenceId: string;
  /** 1-based, contiguous within a sequence — renormalized after delete/reorder. */
  position: number;
  name: string;
  subject: string;
  preheader: string | null;
  /** §5 — optional, independent-per-step header shown before the body; sanitized the same way as htmlBody. */
  htmlHeader: string | null;
  htmlBody: string;
  plainTextBody: string;
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
  status: SequenceStepStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateSequenceStepInput {
  organizationId: string;
  sequenceId: string;
  position: number;
  name: string;
  subject: string;
  preheader?: string | null;
  htmlHeader?: string | null;
  htmlBody: string;
  plainTextBody: string;
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
  createdBy: string;
}

export interface UpdateSequenceStepInput {
  position?: number;
  name?: string;
  subject?: string;
  preheader?: string | null;
  htmlHeader?: string | null;
  htmlBody?: string;
  plainTextBody?: string;
  delayValue?: number;
  delayUnit?: DelayUnit;
  sendMode?: StepSendMode;
  status?: SequenceStepStatus;
  updatedBy?: string;
}
