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
}
