import { DomainStatus } from '../../domain/domain-entity/domain.entity';

export interface DomainSummary {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  domainName: string;
  status: DomainStatus;
  notes: string | null;
  mailboxCount: number;
  sequenceCount: number;
  newConversationCount: number;
  pendingConversationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDomainPayload {
  domainName: string;
  notes?: string;
}

export interface UpdateDomainPayload {
  domainName?: string;
  status?: DomainStatus;
  notes?: string | null;
}
