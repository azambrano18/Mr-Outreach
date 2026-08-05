import { Injectable } from '@nestjs/common';
import { ConversationReadState as PrismaConversationReadStateRow } from '@prisma/client';
import {
  ConversationReadState,
  MarkConversationReadInput,
} from '../../../domain/conversation/conversation-read-state.entity';
import { ConversationReadStateRepository } from '../../../domain/conversation/conversation-read-state.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaConversationReadStateRow): ConversationReadState {
  return {
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    userId: row.userId,
    lastReadMessageId: row.lastReadMessageId,
    lastReadAt: row.lastReadAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaConversationReadStateRepository implements ConversationReadStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForUser(conversationId: string, userId: string): Promise<ConversationReadState | null> {
    const row = await this.prisma.conversationReadState.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return row ? toDomain(row) : null;
  }

  async findAllForUser(
    organizationId: string,
    userId: string,
    conversationIds: string[],
  ): Promise<ConversationReadState[]> {
    if (conversationIds.length === 0) return [];
    const rows = await this.prisma.conversationReadState.findMany({
      where: { organizationId, userId, conversationId: { in: conversationIds } },
    });
    return rows.map(toDomain);
  }

  async markRead(input: MarkConversationReadInput): Promise<ConversationReadState> {
    const row = await this.prisma.conversationReadState.upsert({
      where: { conversationId_userId: { conversationId: input.conversationId, userId: input.userId } },
      create: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        userId: input.userId,
        lastReadMessageId: input.lastReadMessageId,
        lastReadAt: input.lastReadAt,
      },
      update: {
        lastReadMessageId: input.lastReadMessageId,
        lastReadAt: input.lastReadAt,
      },
    });
    return toDomain(row);
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    await this.prisma.conversationReadState.deleteMany({ where: { conversationId } });
  }
}
