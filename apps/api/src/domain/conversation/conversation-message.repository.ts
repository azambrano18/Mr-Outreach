import { ConversationMessage, CreateConversationMessageInput } from './conversation-message.entity';

export interface ConversationMessageRepository {
  findByConversation(conversationId: string): Promise<ConversationMessage[]>;
  findByEmailMessageId(
    conversationId: string,
    emailMessageId: string,
  ): Promise<ConversationMessage | null>;
  create(input: CreateConversationMessageInput): Promise<ConversationMessage>;
}
