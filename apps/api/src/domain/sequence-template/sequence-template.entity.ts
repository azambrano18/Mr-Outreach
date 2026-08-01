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
   * Vestigial — written once at creation (SequenceTemplatesService.create),
   * never read or updated again since Fase 2 (R2). A Plantilla no longer
   * owns an independent signature draft: `SequenceTemplatesService.getDetail`
   * and the publish/update use-cases always read the mailbox's current
   * signature live instead (`getSignatureHtmlForMailbox`), since a mailbox
   * has exactly one signature shared by every one of its Plantillas.
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
