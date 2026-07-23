export type ManagedClientStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';

/**
 * `ManagedClient` is the customer whose outbound campaigns are operated
 * from Mr Outreach (e.g. "Vertex", "GTD") — deliberately NOT the same
 * concept as `Organization` (the company that pays for/uses Mr Outreach
 * itself, e.g. "MejoReferido"). Every ManagedClient belongs to exactly one
 * Organization via organizationId; never mix clients across organizations.
 */
export interface ManagedClient {
  id: string;
  organizationId: string;
  /** Foreign key into the external Neon CRM's master row (maestro_clientes.id) — never written back there. */
  crmClientId: number;
  /** Fase 1.5 — snapshot of maestro_clientes.empresa. No longer administrator-editable; only upsertFromVerifiedCrmClient writes this. */
  name: string;
  legalName: string | null;
  internalCode: string | null;
  /** Fase 1.5 — snapshot of maestro_clientes.rubro. No longer administrator-editable; only upsertFromVerifiedCrmClient writes this. */
  industry: string | null;
  status: ManagedClientStatus;
  logoUrl: string | null;
  startDate: Date | null;
  supervisorUserId: string | null;
  notes: string | null;
  /** Fase 1.5 — last known maestro_clientes.rut. Display/audit only — never used to authorize anything. */
  crmRutSnapshot: string | null;
  /** Fase 1.5 — last known maestro_clientes.status, normalized (TRIM+UPPER not applied here — stored as CrmClientsService returns it). Distinct from `status` (Mr Outreach's own operational lifecycle). */
  crmStatusSnapshot: string | null;
  /** Fase 1.5 — when crmStatusSnapshot was last confirmed against the CRM. Never used, by itself, to authorize a new operation when the CRM is unreachable. */
  crmStatusCheckedAt: Date | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateManagedClientInput {
  organizationId: string;
  crmClientId: number;
  name: string;
  legalName?: string | null;
  internalCode?: string | null;
  industry?: string | null;
  logoUrl?: string | null;
  startDate?: Date | null;
  supervisorUserId?: string | null;
  notes?: string | null;
  crmRutSnapshot?: string | null;
  crmStatusSnapshot?: string | null;
  crmStatusCheckedAt?: Date | null;
  createdBy: string;
}

export interface UpdateManagedClientInput {
  name?: string;
  legalName?: string | null;
  internalCode?: string | null;
  industry?: string | null;
  status?: ManagedClientStatus;
  logoUrl?: string | null;
  startDate?: Date | null;
  supervisorUserId?: string | null;
  notes?: string | null;
  crmRutSnapshot?: string | null;
  crmStatusSnapshot?: string | null;
  crmStatusCheckedAt?: Date | null;
  updatedBy?: string;
  deletedAt?: Date | null;
}
