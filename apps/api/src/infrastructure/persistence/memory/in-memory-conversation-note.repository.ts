import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ConversationNote,
  CreateConversationNoteInput,
  UpdateConversationNoteInput,
} from '../../../domain/conversation/conversation-note.entity';
import { ConversationNoteRepository } from '../../../domain/conversation/conversation-note.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryConversationNoteRepository implements ConversationNoteRepository {
  constructor(private readonly store: MemoryStore) {}

  async findByConversation(conversationId: string): Promise<ConversationNote[]> {
    return this.store.conversationNotes
      .filter((note) => note.conversationId === conversationId && !note.deletedAt)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findById(id: string): Promise<ConversationNote | null> {
    const note = this.store.conversationNotes.find((candidate) => candidate.id === id);
    return note && !note.deletedAt ? note : null;
  }

  async create(input: CreateConversationNoteInput): Promise<ConversationNote> {
    const now = new Date();
    const note: ConversationNote = {
      id: randomUUID(),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      authorUserId: input.authorUserId,
      content: input.content,
      responseOutcome: input.responseOutcome ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.conversationNotes.push(note);
    return note;
  }

  async update(id: string, input: UpdateConversationNoteInput): Promise<ConversationNote> {
    const index = this.store.conversationNotes.findIndex((note) => note.id === id);
    if (index === -1) {
      throw new NotFoundException('Note not found.');
    }
    const updated: ConversationNote = {
      ...this.store.conversationNotes[index],
      ...input,
      updatedAt: new Date(),
    };
    this.store.conversationNotes[index] = updated;
    return updated;
  }
}
