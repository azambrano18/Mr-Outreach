import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ConversationTag,
  CreateConversationTagInput,
  UpdateConversationTagInput,
} from '../../../domain/conversation/conversation-tag.entity';
import { ConversationTagRepository } from '../../../domain/conversation/conversation-tag.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryConversationTagRepository implements ConversationTagRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<ConversationTag | null> {
    const tag = this.store.conversationTags.get(id);
    return tag && !tag.deletedAt ? tag : null;
  }

  async findAll(organizationId: string): Promise<ConversationTag[]> {
    return Array.from(this.store.conversationTags.values()).filter(
      (tag) => !tag.deletedAt && tag.organizationId === organizationId,
    );
  }

  async create(input: CreateConversationTagInput): Promise<ConversationTag> {
    const now = new Date();
    const tag: ConversationTag = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      color: input.color,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.conversationTags.set(tag.id, tag);
    return tag;
  }

  async update(id: string, input: UpdateConversationTagInput): Promise<ConversationTag> {
    const existing = this.store.conversationTags.get(id);
    if (!existing) {
      throw new NotFoundException('Tag not found.');
    }
    const updated: ConversationTag = { ...existing, ...input, updatedAt: new Date() };
    this.store.conversationTags.set(id, updated);
    return updated;
  }
}
