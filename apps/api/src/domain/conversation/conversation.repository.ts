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
  findById(id: string): Promise<Conversation | null>;
  findByMailboxAndThread(mailboxId: string, emailThreadId: string): Promise<Conversation | null>;
  findAll(organizationId: string, filter?: ConversationFilter): Promise<Conversation[]>;
  create(input: CreateConversationInput): Promise<Conversation>;
  update(id: string, input: UpdateConversationInput): Promise<Conversation>;
  addTag(conversationId: string, tagId: string, appliedBy: string): Promise<void>;
  removeTag(conversationId: string, tagId: string): Promise<void>;
  listTagIds(conversationId: string): Promise<string[]>;
}
