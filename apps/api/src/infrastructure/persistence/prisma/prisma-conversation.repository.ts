import { Injectable } from '@nestjs/common';
import { Conversation as PrismaConversationRow, Prisma } from '@prisma/client';
import {
  Conversation,
  CreateConversationInput,
  UpdateConversationInput,
} from '../../../domain/conversation/conversation.entity';
import { ConversationFilter, ConversationRepository } from '../../../domain/conversation/conversation.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaConversationRow): Conversation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    domainId: row.domainId,
    mailboxId: row.mailboxId,
    emailThreadId: row.emailThreadId,
    contactEmail: row.contactEmail,
    contactName: row.contactName,
    companyNameSnapshot: row.companyNameSnapshot,
    contactId: row.contactId,
    companyId: row.companyId,
    origin: row.origin,
    sequenceContactId: row.sequenceContactId,
    originatingScheduledEmailId: row.originatingScheduledEmailId,
    sequenceId: row.sequenceId,
    sequenceStepId: row.sequenceStepId,
    sequenceExecutionId: row.sequenceExecutionId,
    prospectImportRowId: row.prospectImportRowId,
    assignedExecutiveId: row.assignedExecutiveId,
    subject: row.subject,
    managementStatus: row.managementStatus,
    classification: row.classification,
    responseOutcome: row.responseOutcome,
    isUnread: row.isUnread,
    lastMessageAt: row.lastMessageAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Conversation | null> {
    const row = await this.prisma.conversation.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByMailboxAndThread(mailboxId: string, emailThreadId: string): Promise<Conversation | null> {
    const row = await this.prisma.conversation.findFirst({
      where: { mailboxId, emailThreadId, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string, filter: ConversationFilter = {}): Promise<Conversation[]> {
    const where: Prisma.ConversationWhereInput = { organizationId, deletedAt: null };
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.domainId) where.domainId = filter.domainId;
    if (filter.mailboxId) where.mailboxId = filter.mailboxId;
    if (filter.assignedExecutiveId) where.assignedExecutiveId = filter.assignedExecutiveId;
    if (filter.sequenceId) where.sequenceId = filter.sequenceId;
    if (filter.sequenceExecutionId) where.sequenceExecutionId = filter.sequenceExecutionId;
    if (filter.origin) where.origin = filter.origin as never;
    if (filter.managementStatus) where.managementStatus = filter.managementStatus as never;
    if (filter.classification) where.classification = filter.classification as never;
    if (filter.responseOutcome === 'UNCLASSIFIED') {
      where.responseOutcome = null;
    } else if (filter.responseOutcome) {
      where.responseOutcome = filter.responseOutcome as never;
    }
    if (filter.isUnread !== undefined) where.isUnread = filter.isUnread;
    if (filter.tagId) {
      where.tagAssignments = { some: { tagId: filter.tagId } };
    }
    if (filter.unmatchedOnly) {
      where.mailbox = { clientId: null };
    }
    if (filter.dateFrom || filter.dateTo) {
      where.lastMessageAt = {
        ...(filter.dateFrom ? { gte: new Date(filter.dateFrom) } : {}),
        ...(filter.dateTo ? { lte: new Date(filter.dateTo) } : {}),
      };
    }
    if (filter.search) {
      const needle = filter.search;
      where.OR = [
        { subject: { contains: needle, mode: 'insensitive' } },
        { contactEmail: { contains: needle, mode: 'insensitive' } },
        { contactName: { contains: needle, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.conversation.findMany({ where, orderBy: { lastMessageAt: 'desc' } });
    return rows.map(toDomain);
  }

  async create(input: CreateConversationInput, ctx?: TransactionContext): Promise<Conversation> {
    const row = await resolveClient(this.prisma, ctx).conversation.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        domainId: input.domainId,
        mailboxId: input.mailboxId,
        emailThreadId: input.emailThreadId,
        contactEmail: input.contactEmail,
        contactName: input.contactName,
        companyNameSnapshot: input.companyNameSnapshot ?? null,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        origin: input.origin as never,
        sequenceContactId: input.sequenceContactId ?? null,
        originatingScheduledEmailId: input.originatingScheduledEmailId ?? null,
        sequenceId: input.sequenceId ?? null,
        sequenceStepId: input.sequenceStepId ?? null,
        sequenceExecutionId: input.sequenceExecutionId ?? null,
        prospectImportRowId: input.prospectImportRowId ?? null,
        assignedExecutiveId: input.assignedExecutiveId ?? null,
        subject: input.subject,
        classification: (input.classification ?? 'UNCLASSIFIED') as never,
        isUnread: input.isUnread,
        lastMessageAt: input.lastMessageAt,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateConversationInput, ctx?: TransactionContext): Promise<Conversation> {
    const row = await resolveClient(this.prisma, ctx).conversation.update({
      where: { id },
      data: input as Prisma.ConversationUpdateInput,
    });
    return toDomain(row);
  }

  async addTag(conversationId: string, tagId: string, appliedBy: string, ctx?: TransactionContext): Promise<void> {
    const client = resolveClient(this.prisma, ctx);
    const conversation = await client.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return;
    const tag = await client.conversationTag.findUnique({ where: { id: tagId } });
    // Never assign a tag from a different organization to this conversation.
    if (!tag || tag.organizationId !== conversation.organizationId) return;
    await client.conversationTagAssignment.upsert({
      where: { conversationId_tagId: { conversationId, tagId } },
      create: { conversationId, tagId, organizationId: conversation.organizationId, assignedByUserId: appliedBy },
      update: {},
    });
  }

  async removeTag(conversationId: string, tagId: string, ctx?: TransactionContext): Promise<void> {
    await resolveClient(this.prisma, ctx)
      .conversationTagAssignment.deleteMany({ where: { conversationId, tagId } });
  }

  async listTagIds(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.conversationTagAssignment.findMany({
      where: { conversationId },
      select: { tagId: true },
    });
    return rows.map((r) => r.tagId);
  }
}
