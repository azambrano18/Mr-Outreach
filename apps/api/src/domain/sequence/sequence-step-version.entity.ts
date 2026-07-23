import { DelayUnit, StepSendMode } from './sequence-step.entity';

/**
 * Immutable history entry — created whenever a step is saved (create or
 * a subsequent update), never edited or deleted afterwards. Same pattern
 * as SignatureVersion (Fase 9): a snapshot per explicit save, not per
 * keystroke.
 */
export interface SequenceStepVersion {
  id: string;
  sequenceStepId: string;
  versionNumber: number;
  subject: string;
  preheader: string | null;
  htmlHeader: string | null;
  htmlBody: string;
  plainTextBody: string;
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
  createdBy: string;
  createdAt: Date;
}

export interface CreateSequenceStepVersionInput {
  sequenceStepId: string;
  subject: string;
  preheader: string | null;
  htmlHeader?: string | null;
  htmlBody: string;
  plainTextBody: string;
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
  createdBy: string;
}
