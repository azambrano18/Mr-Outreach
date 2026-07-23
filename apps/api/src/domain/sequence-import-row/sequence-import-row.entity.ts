/**
 * Fase 1 — new. Before this phase, SequenceImportsService kept every
 * parsed/accepted row in its own process-local Map (never persisted); a
 * restart between upload and materialization silently lost them. One row
 * per line of the uploaded file, written once column mapping + validation
 * classify it (see SequenceImportsService.setMappingAndValidate) — the
 * narrow upload→mapping gap (raw file rows with no mapping chosen yet)
 * still lives in a short-lived in-process cache, since nothing has been
 * "imported" yet at that point; see the service's own comment.
 */
export type SequenceImportRowValidationStatus = 'VALID' | 'INVALID' | 'DUPLICATE' | 'EXCLUDED';

export interface SequenceImportRow {
  id: string;
  organizationId: string;
  importId: string;
  /** 1-based position in the uploaded file — matches ImportRejection.row. */
  rowNumber: number;
  /** The raw column values for this row, keyed by original file header. */
  rawData: Record<string, string>;
  /** Populated only for VALID rows — the mapped/normalized fields used to create the Contact. */
  normalizedData: NormalizedImportRowData | null;
  companyRawName: string | null;
  email: string | null;
  validationStatus: SequenceImportRowValidationStatus;
  validationErrors: string[];
  isDuplicate: boolean;
  rejectionReason: string | null;
  /** Set once materialize() creates (or reuses) the Contact for this row. */
  contactId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NormalizedImportRowData {
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  companyRawName: string | null;
  jobTitle: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  linkedin: string | null;
}

export interface CreateSequenceImportRowInput {
  organizationId: string;
  importId: string;
  rowNumber: number;
  rawData: Record<string, string>;
  normalizedData?: NormalizedImportRowData | null;
  companyRawName?: string | null;
  email?: string | null;
  validationStatus: SequenceImportRowValidationStatus;
  validationErrors?: string[];
  isDuplicate?: boolean;
  rejectionReason?: string | null;
}

export interface UpdateSequenceImportRowInput {
  contactId?: string | null;
}
