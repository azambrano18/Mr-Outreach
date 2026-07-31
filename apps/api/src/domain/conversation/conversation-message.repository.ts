import { TransactionContext } from '../persistence/transaction';
import { ConversationMessage, CreateConversationMessageInput, UpdateConversationMessageInput } from './conversation-message.entity';

export interface ConversationMessageRepository {
  findByConversation(conversationId: string): Promise<ConversationMessage[]>;
  findByEmailMessageId(
    conversationId: string,
    emailMessageId: string,
  ): Promise<ConversationMessage | null>;
  /** Fase "Recepción de eventos del motor" — resolves an inbound reply's In-Reply-To/References header to the local OUTBOUND message it answers. */
  findByMessageIdHeader(organizationId: string, messageIdHeader: string, ctx?: TransactionContext): Promise<ConversationMessage | null>;
  /** Same idea, keyed by the motor's own outbound message id instead of the RFC822 header. */
  findByOutboundMessageId(organizationId: string, outboundMessageId: string, ctx?: TransactionContext): Promise<ConversationMessage | null>;
  create(input: CreateConversationMessageInput, ctx?: TransactionContext): Promise<ConversationMessage>;
  /** OUTBOUND_MESSAGE_SENT updates the same row OUTBOUND_MESSAGE_CREATED made — never a second row. */
  update(id: string, input: UpdateConversationMessageInput, ctx?: TransactionContext): Promise<ConversationMessage>;
}
