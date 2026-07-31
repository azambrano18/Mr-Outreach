import { TransactionContext } from '../persistence/transaction';
import {
  Conversation,
  ConversationClassification,
  ConversationManagementStatus,
  ConversationOrigin,
  CreateConversationInput,
  ResponseOutcome,
  UpdateConversationInput,
} from './conversation.entity';

export interface ConversationFilter {
  clientId?: string;
  domainId?: string;
  mailboxId?: string;
  assignedExecutiveId?: string;
  sequenceId?: string;
  sequenceExecutionId?: string;
  origin?: ConversationOrigin;
  /** Last-resort INBOUND_MESSAGE_RECEIVED resolution fallback — exact, case-insensitive match. */
  contactEmail?: string;
  managementStatus?: ConversationManagementStatus;
  classification?: ConversationClassification;
  /** §7 — 'UNCLASSIFIED' is the "Sin clasificar" sentinel (matches `responseOutcome === null`); undefined means no filter. */
  responseOutcome?: ResponseOutcome | 'UNCLASSIFIED';
  tagId?: string;
  isUnread?: boolean;
  /** Case-insensitive substring match against subject/contact name/contact email. */
  search?: string;
  /** Conversations belonging to a mailbox that has no client/domain yet — "Mensajes sin identificar". */
  unmatchedOnly?: boolean;
  /** Inclusive lower/upper bounds on `lastMessageAt`, as ISO date strings. */
  dateFrom?: string;
  dateTo?: string;
}

export interface ConversationRepository {
  findById(id: string, ctx?: TransactionContext): Promise<Conversation | null>;
  findByMailboxAndThread(mailboxId: string, emailThreadId: string, ctx?: TransactionContext): Promise<Conversation | null>;
  findAll(organizationId: string, filter?: ConversationFilter): Promise<Conversation[]>;
  create(input: CreateConversationInput, ctx?: TransactionContext): Promise<Conversation>;
  update(id: string, input: UpdateConversationInput, ctx?: TransactionContext): Promise<Conversation>;
  addTag(conversationId: string, tagId: string, appliedBy: string, ctx?: TransactionContext): Promise<void>;
  removeTag(conversationId: string, tagId: string, ctx?: TransactionContext): Promise<void>;
  listTagIds(conversationId: string): Promise<string[]>;
}
