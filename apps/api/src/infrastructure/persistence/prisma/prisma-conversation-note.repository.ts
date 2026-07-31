import { Injectable } from '@nestjs/common';
import { ConversationNote as PrismaConversationNoteRow } from '@prisma/client';
import {
  ConversationNote,
  CreateConversationNoteInput,
  UpdateConversationNoteInput,
} from '../../../domain/conversation/conversation-note.entity';
import { ConversationNoteRepository } from '../../../domain/conversation/conversation-note.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaConversationNoteRow): ConversationNote {
  return {
    id: row.id,
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    authorUserId: row.authorUserId,
    content: row.content,
    responseOutcome: row.responseOutcome,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaConversationNoteRepository implements ConversationNoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByConversation(conversationId: string): Promise<ConversationNote[]> {
    const rows = await this.prisma.conversationNote.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<ConversationNote | null> {
    const row = await this.prisma.conversationNote.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async create(input: CreateConversationNoteInput): Promise<ConversationNote> {
    const row = await this.prisma.conversationNote.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        authorUserId: input.authorUserId,
        content: input.content,
        responseOutcome: (input.responseOutcome ?? null) as never,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateConversationNoteInput): Promise<ConversationNote> {
    const row = await this.prisma.conversationNote.update({ where: { id }, data: input });
    return toDomain(row);
  }
}
