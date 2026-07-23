import { ResponseOutcome } from './conversation.entity';

export interface ConversationNote {
  id: string;
  organizationId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  /** Set when this note was auto-created from the "Resultado de la respuesta" modal, so it stays traceable to the decision that produced it — null for manually-added notes. */
  responseOutcome: ResponseOutcome | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateConversationNoteInput {
  organizationId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  responseOutcome?: ResponseOutcome | null;
}

export interface UpdateConversationNoteInput {
  content?: string;
  deletedAt?: Date | null;
}
