export type ManagedClientStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';

/** Which system is authoritative for this client's identity. */
export type ManagedClientSource = 'SERVER' | 'MANUAL';

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
  /** SERVER: created from a mailbox-link token redemption. MANUAL: reserved. */
  source: ManagedClientSource;
  /** External server client id, set when source = SERVER; the dedupe/upsert key for repeated redemptions. */
  serverClientId: string | null;
  /** Snapshot of the client's corporate name reported by the external server. No longer administrator-editable; only upsertFromServerPayload writes this. */
  name: string;
  legalName: string | null;
  internalCode: string | null;
  /** Snapshot of the client's industry reported by the external server. No longer administrator-editable; only upsertFromServerPayload writes this. */
  industry: string | null;
  status: ManagedClientStatus;
  logoUrl: string | null;
  startDate: Date | null;
  supervisorUserId: string | null;
  notes: string | null;
  /** Last known RUT reported by the external server. Display/audit only — never used to authorize anything. */
  clientRutSnapshot: string | null;
  /** Last known status reported by the external server. Distinct from `status` (Mr Outreach's own operational lifecycle). */
  externalStatusSnapshot: string | null;
  /** When externalStatusSnapshot was last confirmed against the external server. Never used, by itself, to authorize a new operation when the server is unreachable. */
  externalStatusCheckedAt: Date | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateManagedClientInput {
  organizationId: string;
  source?: ManagedClientSource;
  serverClientId?: string | null;
  name: string;
  legalName?: string | null;
  internalCode?: string | null;
  industry?: string | null;
  logoUrl?: string | null;
  startDate?: Date | null;
  supervisorUserId?: string | null;
  notes?: string | null;
  clientRutSnapshot?: string | null;
  externalStatusSnapshot?: string | null;
  externalStatusCheckedAt?: Date | null;
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
  clientRutSnapshot?: string | null;
  externalStatusSnapshot?: string | null;
  externalStatusCheckedAt?: Date | null;
  updatedBy?: string;
  deletedAt?: Date | null;
}
