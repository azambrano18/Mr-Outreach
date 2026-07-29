/**
 * §15/§16 — scoped to a SequenceExecution (Gestión), not a template. A
 * deliberately simpler ColumnMapping than SequenceImport's (no CRM
 * Company/Contact materialization — Railway owns the actual send, Mr
 * Outreach only needs normalized rows to bundle into the
 * SEQUENCE_EXECUTION_START JSON payload): fixed `email`/`contact_name`/
 * `company_name` plus an open `customVariables` map keyed by the
 * template's own variable keys (§16 — "no debe permitirse publicar una
 * plantilla con variables inválidas o sin cerrar").
 */
export type ProspectImportStatus = 'UPLOADED' | 'MAPPING_REQUIRED' | 'VALIDATING' | 'READY' | 'FAILED';

export interface ProspectColumnMapping {
  email: string;
  contactName: string | null;
  companyName: string | null;
  /** templateVariableKey -> column header. Only variables actually used by the execution's template version. */
  customVariables: Record<string, string>;
}

export interface ProspectImport {
  id: string;
  organizationId: string;
  executionId: string;
  fileName: string;
  storageKey: string;
  checksum: string;
  status: ProspectImportStatus;
  columnMapping: ProspectColumnMapping | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  excludedRows: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProspectImportInput {
  organizationId: string;
  executionId: string;
  fileName: string;
  storageKey: string;
  checksum: string;
  createdBy: string;
}

export interface UpdateProspectImportInput {
  status?: ProspectImportStatus;
  columnMapping?: ProspectColumnMapping | null;
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
  duplicateRows?: number;
  excludedRows?: number;
}
