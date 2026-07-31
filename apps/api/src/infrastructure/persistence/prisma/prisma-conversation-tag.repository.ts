import { Injectable } from '@nestjs/common';
import { ConversationTag as PrismaConversationTagRow } from '@prisma/client';
import {
  ConversationTag,
  CreateConversationTagInput,
  UpdateConversationTagInput,
} from '../../../domain/conversation/conversation-tag.entity';
import { ConversationTagRepository } from '../../../domain/conversation/conversation-tag.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaConversationTagRow): ConversationTag {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    color: row.color,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaConversationTagRepository implements ConversationTagRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<ConversationTag | null> {
    const row = await this.prisma.conversationTag.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string): Promise<ConversationTag[]> {
    const rows = await this.prisma.conversationTag.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDomain);
  }

  async create(input: CreateConversationTagInput): Promise<ConversationTag> {
    const row = await this.prisma.conversationTag.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        color: input.color,
        createdBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateConversationTagInput): Promise<ConversationTag> {
    const row = await this.prisma.conversationTag.update({ where: { id }, data: input });
    return toDomain(row);
  }
}
