/**
 * Etapa "cuenta del ejecutivo" — a Plantilla is reusable content, always
 * scoped to exactly one Mailbox (the identity it will always send as; see
 * SequenceTemplate's class comment in the service layer for why). Distinct
 * from `Sequence` (the older, still-untouched hybrid template+execution
 * entity that continues to back the admin "Secuencias" monitor and wizard)
 * — a Plantilla never carries an executive's prospects, start date or
 * server-execution state; that all lives on `SequenceExecution`.
 */
export type SequenceTemplateStatus = 'DRAFT' | 'PUBLISHING' | 'PUBLISHED' | 'PUBLISH_FAILED' | 'ARCHIVED';

export interface SequenceTemplate {
  id: string;
  organizationId: string;
  ownerUserId: string;
  mailboxId: string;
  /** §1 (Fase 1.7) — required, executive-chosen; identifies the Plantilla's purpose. Shared unchanged across every version. */
  name: string;
  description: string | null;
  /** §5 — shared across the 3 envíos. Never duplicated per-envío. */
  subjectTemplate: string;
  /** Vestigial — header moved back to per-envío (SequenceTemplateStep.headerText). Never read/written. */
  headerText: string | null;
  /**
   * Fase Firma — the Plantilla's own editable signature draft, authored
   * inside this template's editor (never the mailbox's). Sanitized HTML,
   * frozen into `SequenceTemplateVersion.signatureHtml` at publish time;
   * editing it afterward never touches an already-published version. See
   * SequenceTemplatesService.create() for the one-time migration snapshot
   * taken from the mailbox's legacy Signature, for templates that predate
   * this field.
   */
  signatureHtml: string;
  status: SequenceTemplateStatus;
  /** Bumped every time a publish-relevant field changes on the template or its steps since the last publish attempt. */
  currentDraftVersion: number;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  /** §11 — logical delete for an archived template. Filtered out of every listing/lookup; never a hard delete. */
  deletedAt: Date | null;
}

export interface CreateSequenceTemplateInput {
  organizationId: string;
  ownerUserId: string;
  mailboxId: string;
  name: string;
  description?: string | null;
  timezone: string;
  signatureHtml: string;
}

export interface UpdateSequenceTemplateInput {
  name?: string;
  description?: string | null;
  subjectTemplate?: string;
  signatureHtml?: string;
  status?: SequenceTemplateStatus;
  currentDraftVersion?: number;
  archivedAt?: Date | null;
  deletedAt?: Date | null;
}
