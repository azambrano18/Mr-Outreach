export type ProspectImportRowValidationStatus = 'VALID' | 'INVALID' | 'DUPLICATE';

/** Fully mapped/normalized shape ready to bundle into the SEQUENCE_EXECUTION_START JSON's `prospects[]`. */
export interface NormalizedProspectData {
  email: string;
  contactName: string | null;
  companyName: string | null;
  /** templateVariableKey -> resolved value for this row. */
  variables: Record<string, string>;
}

/**
 * §2/§11 — server-administered per-prospect lifecycle. Mr Outreach never
 * assigns or transitions these on its own initiative — it only records
 * what the server itself reported (at submission, or on a later refresh).
 * A row stays `null` until the Gestión is actually accepted by the server.
 */
export type ProspectExecutionState =
  | 'STEP_01_PENDING'
  | 'STEP_01_PROCESSING'
  | 'STEP_01_SENT'
  | 'STEP_02_PENDING'
  | 'STEP_02_PROCESSING'
  | 'STEP_02_SENT'
  | 'STEP_03_PENDING'
  | 'STEP_03_PROCESSING'
  | 'STEP_03_SENT'
  | 'COMPLETED'
  | 'FAILED';

export interface ProspectImportRow {
  id: string;
  organizationId: string;
  importId: string;
  rowNumber: number;
  rawData: Record<string, string>;
  normalizedData: NormalizedProspectData | null;
  validationStatus: ProspectImportRowValidationStatus;
  validationErrors: string[];
  /** Null until the Gestión this row belongs to is accepted by the server. */
  executionState: ProspectExecutionState | null;
  createdAt: Date;
}

export interface CreateProspectImportRowInput {
  organizationId: string;
  importId: string;
  rowNumber: number;
  rawData: Record<string, string>;
  normalizedData?: NormalizedProspectData | null;
  validationStatus: ProspectImportRowValidationStatus;
  validationErrors?: string[];
}
