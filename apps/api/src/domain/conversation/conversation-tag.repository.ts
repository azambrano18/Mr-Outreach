import {
  ConversationTag,
  CreateConversationTagInput,
  UpdateConversationTagInput,
} from './conversation-tag.entity';

export interface ConversationTagRepository {
  findById(id: string): Promise<ConversationTag | null>;
  findAll(organizationId: string): Promise<ConversationTag[]>;
  create(input: CreateConversationTagInput): Promise<ConversationTag>;
  update(id: string, input: UpdateConversationTagInput): Promise<ConversationTag>;
}
