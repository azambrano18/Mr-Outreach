import { CrmClient } from './crm-client.entity';

export interface CrmClientFilter {
  /** Matched against the client's name (empresa), case-insensitive substring. */
  search?: string;
}

export interface CrmClientRepository {
  /** Always filters to active clients only (§2.3) — the CRM read module never exposes an "include inactive" toggle. */
  findAllActive(filter?: CrmClientFilter): Promise<CrmClient[]>;
  /** Not filtered by status — the client detail page must show the real CRM state even if it later became inactive. */
  findById(crmClientId: number): Promise<CrmClient | null>;
}
