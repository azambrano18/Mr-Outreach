import { ResponseOutcome } from '../../domain/conversation/conversation.entity';

/** §7 — one row per mailbox eligible to back "Conversaciones de prueba": not deleted, linked, and assigned to the requesting admin (so the generated conversations are guaranteed reachable from that admin's own "Cuentas de correos" tree). */
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
  createdAt: Date;
  conversations: SimulationConversationSummary[];
}

export interface GenerateSimulationConversationsInput {
  organizationId: string;
  actorId: string;
  mailboxId: string;
  idempotencyKey: string;
}

/** §14 — shown before the admin confirms "Eliminar conversaciones de prueba". */
export interface DeleteSimulationConversationsPreview {
  batch: SimulationBatchSummary;
  conversationCount: number;
  messageCount: number;
  contactCount: number;
  companyCount: number;
  sequenceCount: number;
}

export interface DeleteSimulationConversationsResult {
  batchId: string;
  conversationsDeleted: number;
  messagesDeleted: number;
  contactsDeleted: number;
  companiesDeleted: number;
  sequencesDeleted: number;
}
