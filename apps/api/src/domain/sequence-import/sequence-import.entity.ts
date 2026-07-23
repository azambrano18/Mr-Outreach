/** §19 — the full lifecycle, including the terminal outcomes the simulator must be able to demonstrate. */
export type SequenceImportStatus =
  | 'UPLOADED'
  | 'MAPPING_REQUIRED'
  | 'VALIDATING'
  | 'READY'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** §20 — selectable before confirming, so a demo can show every outcome on request. */
export type ImportScenario =
  | 'ALL_ACCEPTED'
  | 'WITH_DUPLICATES'
  | 'WITH_INVALID'
  | 'WITH_EXCLUDED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'TIMEOUT';

export interface ColumnMapping {
  email: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  company?: string;
  jobTitle?: string;
  phone?: string;
  city?: string;
  country?: string;
  website?: string;
  linkedin?: string;
  customFields?: Record<string, string>;
}

export interface ImportRejection {
  row: number;
  reason: 'INVALID_EMAIL' | 'DUPLICATE' | 'EXCLUDED_CONTACT' | 'EXCLUDED_COMPANY' | 'MISSING_REQUIRED_FIELD';
  detail: string;
}

export interface SequenceImport {
  id: string;
  organizationId: string;
  clientId: string;
  sequenceId: string;
  executiveId: string;
  mailboxId: string;
  status: SequenceImportStatus;
  fileName: string;
  storageKey: string;
  checksum: string;
  columnMapping: ColumnMapping | null;
  scenario: ImportScenario | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  excludedRows: number;
  companiesDetected: number;
  contactsAccepted: number;
  contactsRejected: number;
  rejections: ImportRejection[];
  commandId: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSequenceImportInput {
  organizationId: string;
  clientId: string;
  sequenceId: string;
  executiveId: string;
  mailboxId: string;
  fileName: string;
  storageKey: string;
  checksum: string;
  totalRows: number;
  createdBy: string;
}

export interface UpdateSequenceImportInput {
  status?: SequenceImportStatus;
  columnMapping?: ColumnMapping;
  scenario?: ImportScenario;
  validRows?: number;
  invalidRows?: number;
  duplicateRows?: number;
  excludedRows?: number;
  companiesDetected?: number;
  contactsAccepted?: number;
  contactsRejected?: number;
  rejections?: ImportRejection[];
  commandId?: string | null;
  lastError?: string | null;
}
