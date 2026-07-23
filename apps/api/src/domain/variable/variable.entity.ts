export type VariableStatus = 'ACTIVE' | 'ARCHIVED';

/**
 * Where the value comes from when the engine actually renders a template —
 * CONTACT/SENDER map to data the engine already has (recipient, mailbox);
 * CUSTOM is filled in manually per send. No contacts/campaigns phase exists
 * yet, so this is a category the catalog carries forward, not something
 * this phase resolves to a real value.
 */
export type VariableSource = 'CONTACT' | 'SENDER' | 'CUSTOM';

export interface Variable {
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

export interface CreateVariableInput {
  organizationId: string;
  key: string;
  label: string;
  description?: string | null;
  source: VariableSource;
}

export interface UpdateVariableInput {
  key?: string;
  label?: string;
  description?: string | null;
  source?: VariableSource;
  status?: VariableStatus;
}
