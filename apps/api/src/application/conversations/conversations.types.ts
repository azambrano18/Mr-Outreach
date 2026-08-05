import {
  ConversationClassification,
  ConversationManagementStatus,
  ResponseOutcome,
} from '../../domain/conversation/conversation.entity';
import {
  ConversationDirection,
  ConversationMessageType,
} from '../../domain/conversation/conversation-message.entity';
import { SequenceContactStatus } from '../../domain/sequence-contact/sequence-contact.entity';

export interface ConversationSummary {
  id: string;
  organizationId: string;
  clientId: string | null;
  clientName: string | null;
  domainId: string | null;
  domainName: string | null;
  mailboxId: string;
  mailboxEmail: string;
  contactEmail: string;
  contactName: string | null;
  /** Set only for conversations created by the simulated-reply flow — see Conversation entity's class comment. */
  contactId: string | null;
  companyId: string | null;
  companyName: string | null;
  sequenceId: string | null;
  sequenceName: string | null;
  sequenceStepId: string | null;
  /** §34 — "originada desde: Step N — Envío N", resolved from `originatingScheduledEmailId`. */
  originatingStepName: string | null;
  originatingStepPosition: number | null;
  /** Resolved from `Conversation.sequenceContactId` — the CONTACT's (the person, not the company) participation status in `sequenceId`, distinct from `managementStatus` (this conversation's own triage state). */
  contactStatus: SequenceContactStatus | null;
  /** The executive's deliberate decision about this reply — see `ResponseOutcome`'s doc comment. */
  responseOutcome: ResponseOutcome | null;
  assignedExecutiveId: string | null;
  assignedExecutiveName: string | null;
  subject: string;
  managementStatus: ConversationManagementStatus;
  classification: ConversationClassification;
  isUnread: boolean;
  lastMessageAt: Date;
  resolvedAt: Date | null;
  archivedAt: Date | null;
  tagIds: string[];
  /** True when the underlying mailbox has no client/domain yet — surfaces in "Mensajes sin identificar". */
  isUnmatched: boolean;
  /** "Conversaciones de prueba" (QA) — true only for a synthetic row created by "Generar conversaciones de prueba". Drives the "Simulación" badge and the Todas/Reales/Simulación filter. */
  isSimulation: boolean;
  /** Set only when isSimulation — the SUGGESTED scenario, shown as a hint only; never equal to the actual classification unless an admin picked it manually. */
  simulationScenario: ResponseOutcome | null;
  createdAt: Date;
}

export interface ConversationMessageSummary {
  id: string;
  direction: ConversationDirection;
  senderEmail: string;
  senderName: string | null;
  recipients: string[];
  cc: string[];
  subject: string;
  htmlBody: string;
  plainTextBody: string;
  receivedAt: Date | null;
  sentAt: Date | null;
  messageType: ConversationMessageType;
}

export interface ConversationNoteSummary {
  id: string;
  authorUserId: string;
  authorName: string;
  content: string;
  responseOutcome: ResponseOutcome | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessageSummary[];
  notes: ConversationNoteSummary[];
}

export interface ConversationListFilter {
  clientId?: string;
  domainId?: string;
  mailboxId?: string;
  assignedExecutiveId?: string;
  sequenceId?: string;
  managementStatus?: ConversationManagementStatus;
  classification?: ConversationClassification;
  /** §7 — 'UNCLASSIFIED' is the "Sin clasificar" sentinel (matches `responseOutcome === null`); undefined means no filter. */
  responseOutcome?: ResponseOutcome | 'UNCLASSIFIED';
  tagId?: string;
  isUnread?: boolean;
  /** "Todas/Reales/Simulación" filter — undefined means no filter. */
  isSimulation?: boolean;
  search?: string;
  unmatchedOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface ConversationCounters {
  total: number;
  new: number;
  pending: number;
  /** Fase "Estado leído/no leído por usuario" — count of conversations unread for the specific caller, never a global count. */
  unread: number;
}

export interface ConversationTagSummary {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationTagPayload {
  name: string;
  color: string;
}

export interface UpdateConversationTagPayload {
  name?: string;
  color?: string;
}

export interface CreateConversationNotePayload {
  content: string;
}

export interface UpdateConversationNotePayload {
  content: string;
}

/** "Cuentas de correos" — Cliente → Dominio → Cuenta, each carrying its own aggregated unread count (§3 of the executive-workspace spec). */
export interface ConversationTreeMailboxNode {
  id: string;
  email: string;
  unreadCount: number;
}

export interface ConversationTreeDomainNode {
  id: string;
  domainName: string;
  unreadCount: number;
  mailboxes: ConversationTreeMailboxNode[];
}

export interface ConversationTreeClientNode {
  id: string;
  name: string;
  unreadCount: number;
  domains: ConversationTreeDomainNode[];
}
