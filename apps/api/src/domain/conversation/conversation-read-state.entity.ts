/**
 * Per-user read state — the source of truth for "has user X read this
 * conversation". `Conversation.isUnread` is a coarser, non-authoritative
 * signal only; a read by one user must never mark it read for anyone else.
 */
export interface ConversationReadState {
  organizationId: string;
  conversationId: string;
  userId: string;
  lastReadMessageId: string | null;
  lastReadAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarkConversationReadInput {
  organizationId: string;
  conversationId: string;
  userId: string;
  lastReadMessageId: string | null;
  lastReadAt: Date;
}
