export type SignatureStatus = 'ACTIVE' | 'ARCHIVED';

/**
 * One per Mailbox. Never stores content directly — the current content is
 * whichever SignatureVersion `activeVersionId` points at, so editing never
 * destroys history (see SignatureVersion).
 */
export interface Signature {
  id: string;
  organizationId: string;
  mailboxId: string;
  status: SignatureStatus;
  activeVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSignatureInput {
  organizationId: string;
  mailboxId: string;
}

export interface UpdateSignatureInput {
  status?: SignatureStatus;
  activeVersionId?: string;
}
