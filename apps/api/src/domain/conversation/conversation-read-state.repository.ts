import { ConversationReadState, MarkConversationReadInput } from './conversation-read-state.entity';

export interface ConversationReadStateRepository {
  findForUser(conversationId: string, userId: string): Promise<ConversationReadState | null>;
  findAllForUser(organizationId: string, userId: string, conversationIds: string[]): Promise<ConversationReadState[]>;
  /** Upsert — a read is idempotent per (conversationId, userId); replays only ever move lastReadAt forward. */
  markRead(input: MarkConversationReadInput): Promise<ConversationReadState>;
}
