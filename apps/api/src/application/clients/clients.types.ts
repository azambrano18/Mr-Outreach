import { ClientAssignmentRole } from '../../domain/client/client-executive-assignment.entity';
import { ManagedClientSource, ManagedClientStatus } from '../../domain/client/managed-client.entity';

export interface ManagedClientSummary {
  id: string;
  organizationId: string;
  source: ManagedClientSource;
  serverClientId: string | null;
  /** Snapshot local del nombre corporativo, reportado por el servidor externo. Ya no editable a mano. */
  name: string;
  legalName: string | null;
  internalCode: string | null;
  /** Snapshot local del rubro corporativo, reportado por el servidor externo. Ya no editable a mano. */
  industry: string | null;
  status: ManagedClientStatus;
  logoUrl: string | null;
  startDate: Date | null;
  supervisorUserId: string | null;
  notes: string | null;
  /** Último RUT conocido, reportado por el servidor externo. Solo informativo. */
  clientRutSnapshot: string | null;
  /** Último estado normalizado conocido del servidor externo. Distinto de `status` (operativo de Mr Outreach). Solo informativo. */
  externalStatusSnapshot: string | null;
  /** Cuándo se verificó por última vez contra el servidor externo. */
  externalStatusCheckedAt: Date | null;
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
