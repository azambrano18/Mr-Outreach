import { ClientAssignmentRole } from '../../domain/client/client-executive-assignment.entity';
import { ManagedClientSource, ManagedClientStatus } from '../../domain/client/managed-client.entity';

export interface ManagedClientSummary {
  id: string;
  organizationId: string;
  /** Null for a SERVER-origin client (Fase 2.1, §9.1) with no CRM linkage. */
  crmClientId: number | null;
  source: ManagedClientSource;
  serverClientId: string | null;
  /** Fase 1.5 — snapshot local del nombre corporativo (maestro_clientes.empresa). Ya no editable a mano. */
  name: string;
  legalName: string | null;
  internalCode: string | null;
  /** Fase 1.5 — snapshot local del rubro corporativo (maestro_clientes.rubro). Ya no editable a mano. */
  industry: string | null;
  status: ManagedClientStatus;
  logoUrl: string | null;
  startDate: Date | null;
  supervisorUserId: string | null;
  notes: string | null;
  /** Fase 1.5 — último RUT conocido del CRM. Solo informativo. */
  crmRutSnapshot: string | null;
  /** Fase 1.5 — último estado normalizado conocido del CRM. Distinto de `status` (operativo de Mr Outreach). Solo informativo. */
  crmStatusSnapshot: string | null;
  /** Fase 1.5 — cuándo se verificó por última vez contra el CRM. */
  crmStatusCheckedAt: Date | null;
  domainCount: number;
  mailboxCount: number;
  sequenceCount: number;
  /** managementStatus === 'NEW' */
  newConversationCount: number;
  /** managementStatus in (NEW, PENDING, IN_PROGRESS) — anything still needing action. */
  pendingConversationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fase 1.5 — "activar cliente en Mr Outreach", ya no "crear cliente":
 * `crmClientId` es el único dato corporativo confiable que el backend
 * acepta del navegador; name/rut/industry/estado siempre se obtienen del
 * CRM (ver CrmClientEligibilityService + ClientsService.upsertFromVerifiedCrmClient).
 */
export interface ActivateManagedClientPayload {
  crmClientId: number;
  legalName?: string;
  internalCode?: string;
  logoUrl?: string;
  startDate?: string;
  supervisorUserId?: string;
  notes?: string;
}

export interface UpdateManagedClientPayload {
  legalName?: string | null;
  internalCode?: string | null;
  status?: ManagedClientStatus;
  logoUrl?: string | null;
  startDate?: string | null;
  supervisorUserId?: string | null;
  notes?: string | null;
}

export interface ClientAssigneeSummary {
  id: string;
  name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  role: ClientAssignmentRole;
}

export interface SetClientAssigneesPayload {
  primaryUserId: string | null;
  secondaryUserIds: string[];
}
