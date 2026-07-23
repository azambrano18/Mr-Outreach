import {
  DelayUnit,
  SequenceStepStatus,
  StepSendMode,
} from '../../domain/sequence/sequence-step.entity';

export interface SequenceStepSummary {
  id: string;
  sequenceId: string;
  position: number;
  name: string;
  subject: string;
  preheader: string | null;
  htmlHeader: string | null;
  htmlBody: string;
  plainTextBody: string;
  variables: string[];
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
  status: SequenceStepStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSequenceStepPayload {
  name: string;
  subject: string;
  preheader?: string;
  htmlHeader?: string | null;
  htmlBody: string;
  plainTextBody?: string;
  delayValue: number;
  delayUnit: DelayUnit;
  sendMode: StepSendMode;
}

export interface UpdateSequenceStepPayload {
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
}

export interface SequenceStepVersionSummary {
  id: string;
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

export interface SequenceStepPreview {
  subject: string;
  renderedSubject: string;
  preheader: string | null;
  renderedPreheader: string | null;
  htmlHeader: string | null;
  renderedHeader: string | null;
  renderedHtml: string;
  renderedPlainText: string;
  variables: string[];
  usesRealSenderData: boolean;
  signatureApplied: boolean;
  senderMailboxEmail: string;
}

export interface SendTestStepResult {
  accepted: boolean;
  message: string;
}
