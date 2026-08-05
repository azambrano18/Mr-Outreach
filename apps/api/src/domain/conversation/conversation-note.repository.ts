import {
  ConversationNote,
  CreateConversationNoteInput,
  UpdateConversationNoteInput,
} from './conversation-note.entity';

export interface ConversationNoteRepository {
  findByConversation(conversationId: string): Promise<ConversationNote[]>;
  findById(id: string): Promise<ConversationNote | null>;
  create(input: CreateConversationNoteInput): Promise<ConversationNote>;
  update(id: string, input: UpdateConversationNoteInput): Promise<ConversationNote>;
  /** "Conversaciones de prueba" (QA) — hard delete every note of a batch-scoped Conversation. Only ever called by DeleteSimulationConversationsUseCase. */
  deleteByConversation(conversationId: string): Promise<void>;
}
