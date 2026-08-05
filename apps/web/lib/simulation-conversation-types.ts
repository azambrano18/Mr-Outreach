import type { ResponseOutcome } from '@outreach/shared-types';

export interface EligibleMailboxSummary {
  id: string;
  email: string;
  clientName: string | null;
  domainName: string | null;
  primaryExecutiveName: string | null;
  status: string;
  linkStatus: string;
}

export interface SimulationConversationSummary {
  id: string;
  scenario: ResponseOutcome;
  label: string;
  contactEmail: string;
  contactName: string;
}

export interface SimulationBatchSummary {
  id: string;
  organizationId: string;
  mailboxId: string;
  mailboxEmail: string;
  createdByUserId: string;
  createdByUserName: string;
  createdAt: string;
  conversations: SimulationConversationSummary[];
}

export interface DeleteSimulationConversationsPreview {
  batch: SimulationBatchSummary;
  conversationCount: number;
  messageCount: number;
  contactCount: number;
  companyCount: number;
  sequenceCount: number;
}
