import { Injectable } from '@nestjs/common';
import {
  ConversationReadState,
  MarkConversationReadInput,
} from '../../../domain/conversation/conversation-read-state.entity';
import { ConversationReadStateRepository } from '../../../domain/conversation/conversation-read-state.repository';
import { MemoryStore } from './memory-store';

function key(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`;
}

@Injectable()
export class InMemoryConversationReadStateRepository implements ConversationReadStateRepository {
  constructor(private readonly store: MemoryStore) {}

  async findForUser(conversationId: string, userId: string): Promise<ConversationReadState | null> {
    return this.store.conversationReadStates.get(key(conversationId, userId)) ?? null;
  }

  async findAllForUser(
    organizationId: string,
    userId: string,
    conversationIds: string[],
  ): Promise<ConversationReadState[]> {
    const wanted = new Set(conversationIds);
    return Array.from(this.store.conversationReadStates.values()).filter(
      (state) => state.organizationId === organizationId && state.userId === userId && wanted.has(state.conversationId),
    );
  }

  async markRead(input: MarkConversationReadInput): Promise<ConversationReadState> {
    const k = key(input.conversationId, input.userId);
    const existing = this.store.conversationReadStates.get(k);
    const now = new Date();
    const state: ConversationReadState = {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      userId: input.userId,
      lastReadMessageId: input.lastReadMessageId,
      lastReadAt: input.lastReadAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.conversationReadStates.set(k, state);
    return state;
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    for (const key of this.store.conversationReadStates.keys()) {
      if (key.startsWith(`${conversationId}:`)) this.store.conversationReadStates.delete(key);
    }
  }
}
