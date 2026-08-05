import { Injectable } from '@nestjs/common';
import { ConversationMessage as PrismaConversationMessageRow, Prisma } from '@prisma/client';
import {
  ConversationMessage,
  CreateConversationMessageInput,
  UpdateConversationMessageInput,
} from '../../../domain/conversation/conversation-message.entity';
import {
  ConversationMessageRepository,
  LastInboundMessageRow,
} from '../../../domain/conversation/conversation-message.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaConversationMessageRow): ConversationMessage {
  return {
    id: row.id,
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    mailboxId: row.mailboxId,
    emailMessageId: row.emailMessageId,
    direction: row.direction,
    serverMessageId: row.serverMessageId,
    outboundMessageId: row.outboundMessageId,
    messageIdHeader: row.messageIdHeader,
    inReplyTo: row.inReplyTo,
    references: row.references,
    senderEmail: row.senderEmail,
    senderName: row.senderName,
    recipients: row.recipients as string[],
    cc: row.cc as string[],
    bcc: row.bcc as string[],
    subject: row.subject,
    htmlBody: row.htmlBody,
    plainTextBody: row.plainTextBody,
    stepNumber: row.stepNumber,
    receivedAt: row.receivedAt,
    sentAt: row.sentAt,
    messageType: row.messageType,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaConversationMessageRepository implements ConversationMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByConversation(conversationId: string): Promise<ConversationMessage[]> {
    const rows = await this.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: [{ receivedAt: 'asc' }, { sentAt: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findByEmailMessageId(conversationId: string, emailMessageId: string): Promise<ConversationMessage | null> {
    const row = await this.prisma.conversationMessage.findUnique({
      where: { conversationId_emailMessageId: { conversationId, emailMessageId } },
    });
    return row ? toDomain(row) : null;
  }

  async findLastInboundForConversations(conversationIds: string[]): Promise<Map<string, LastInboundMessageRow>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ conversationId: string; id: string; receivedAt: Date }>>(
      Prisma.sql`
        SELECT DISTINCT ON ("conversationId") "conversationId", "id", "receivedAt"
        FROM "conversation_messages"
        WHERE "conversationId" IN (${Prisma.join(conversationIds)}) AND "direction" = 'INBOUND'
        ORDER BY "conversationId", "receivedAt" DESC NULLS LAST
      `,
    );
    return new Map(rows.map((row) => [row.conversationId, { id: row.id, receivedAt: row.receivedAt }]));
  }

  async findByMessageIdHeader(
    organizationId: string,
    messageIdHeader: string,
    ctx?: TransactionContext,
  ): Promise<ConversationMessage | null> {
    const row = await resolveClient(this.prisma, ctx).conversationMessage.findUnique({
      where: { organizationId_messageIdHeader: { organizationId, messageIdHeader } },
    });
    return row ? toDomain(row) : null;
  }

  async findByOutboundMessageId(
    organizationId: string,
    outboundMessageId: string,
    ctx?: TransactionContext,
  ): Promise<ConversationMessage | null> {
    const row = await resolveClient(this.prisma, ctx).conversationMessage.findUnique({
      where: { organizationId_outboundMessageId: { organizationId, outboundMessageId } },
    });
    return row ? toDomain(row) : null;
  }

  async update(id: string, input: UpdateConversationMessageInput, ctx?: TransactionContext): Promise<ConversationMessage> {
    const row = await resolveClient(this.prisma, ctx).conversationMessage.update({ where: { id }, data: input });
    return toDomain(row);
  }

  async create(input: CreateConversationMessageInput, ctx?: TransactionContext): Promise<ConversationMessage> {
    const row = await resolveClient(this.prisma, ctx).conversationMessage.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        mailboxId: input.mailboxId,
        emailMessageId: input.emailMessageId,
        direction: input.direction as never,
        serverMessageId: input.serverMessageId ?? null,
        outboundMessageId: input.outboundMessageId ?? null,
        messageIdHeader: input.messageIdHeader ?? null,
        inReplyTo: input.inReplyTo ?? null,
        references: input.references ?? null,
        senderEmail: input.senderEmail,
        senderName: input.senderName ?? null,
        recipients: input.recipients,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        subject: input.subject,
        htmlBody: input.htmlBody,
        plainTextBody: input.plainTextBody,
        stepNumber: input.stepNumber ?? null,
        receivedAt: input.receivedAt ?? null,
        sentAt: input.sentAt ?? null,
        messageType: input.messageType as never,
      },
    });
    return toDomain(row);
  }

  async deleteByConversation(conversationId: string, ctx?: TransactionContext): Promise<void> {
    await resolveClient(this.prisma, ctx).conversationMessage.deleteMany({ where: { conversationId } });
  }
}
