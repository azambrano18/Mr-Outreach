import { SignatureStatus } from '../../domain/signature/signature.entity';

export interface SignatureVersionSummary {
  id: string;
  versionNumber: number;
  htmlContent: string;
  plainTextContent: string;
  variables: string[];
  createdAt: Date;
  createdBy: string;
  isActive: boolean;
}

export interface SignatureSummary {
  id: string;
  mailboxId: string;
  status: SignatureStatus;
  activeVersion: SignatureVersionSummary | null;
  /** Most recent first. */
  versions: SignatureVersionSummary[];
}

export interface SignaturePreview {
  htmlContent: string;
  renderedHtml: string;
  plainTextContent: string;
  renderedPlainText: string;
  variables: string[];
  /** True when at least one {sender.*} value came from a real assigned executive, not the generic example. */
  usesRealSenderData: boolean;
}

export interface SendTestSignatureInput {
  to: string;
}

export interface SendTestSignatureResult {
  accepted: boolean;
  message: string;
}
