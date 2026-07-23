import { VariableSource, VariableStatus } from '../../domain/variable/variable.entity';

export interface VariableSummary {
  id: string;
  organizationId: string;
  key: string;
  label: string;
  description: string | null;
  source: VariableSource;
  status: VariableStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Simplified per spec §5.1 — an admin-created variable is always a bare, {source:'CUSTOM'} entry with just a key and a label. */
export interface CreateVariablePayload {
  key: string;
  label: string;
}

export interface UpdateVariablePayload {
  key?: string;
  label?: string;
}
