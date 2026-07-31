import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ConversationMessage,
  CreateConversationMessageInput,
} from '../../../domain/conversation/conversation-message.entity';
import { ConversationMessageRepository } from '../../../domain/conversation/conversation-message.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryConversationMessageRepository implements ConversationMessageRepository {
  constructor(private readonly store: MemoryStore) {}

  async findByConversation(conversationId: string): Promise<ConversationMessage[]> {
    return this.store.conversationMessages
      .filter((message) => message.conversationId === conversationId)
      .sort((a, b) => {
        const aTime = (a.receivedAt ?? a.sentAt ?? a.createdAt).getTime();
        const bTime = (b.receivedAt ?? b.sentAt ?? b.createdAt).getTime();
        return aTime - bTime;
      });
  }

  async findByEmailMessageId(
    conversationId: string,
    emailMessageId: string,
  ): Promise<ConversationMessage | null> {
    return (
      this.store.conversationMessages.find(
        (message) =>
          message.conversationId === conversationId && message.emailMessageId === emailMessageId,
      ) ?? null
    );
  }

  async create(input: CreateConversationMessageInput): Promise<ConversationMessage> {
    const message: ConversationMessage = {
      id: randomUUID(),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      mailboxId: input.mailboxId,
      emailMessageId: input.emailMessageId,
      direction: input.direction,
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
      messageType: input.messageType,
      createdAt: new Date(),
    };
    this.store.conversationMessages.push(message);
    return message;
  }
}
