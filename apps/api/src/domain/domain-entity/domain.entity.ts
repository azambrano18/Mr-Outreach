/**
 * Named `domain-entity` (folder) / `Domain` (type) deliberately — "domain"
 * is already this codebase's own architectural folder name
 * (`src/domain/...`), so the file lives in its own subfolder to avoid any
 * ambiguity, while the exported type itself is just `Domain`, matching the
 * business term used throughout the spec ("vertex.cl" is a Domain).
 */
export type DomainStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface Domain {
  id: string;
  organizationId: string;
  clientId: string;
  domainName: string;
  status: DomainStatus;
  notes: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateDomainInput {
  organizationId: string;
  clientId: string;
  domainName: string;
  notes?: string | null;
  createdBy: string;
}

export interface UpdateDomainInput {
  domainName?: string;
  status?: DomainStatus;
  notes?: string | null;
  updatedBy?: string;
  deletedAt?: Date | null;
}
