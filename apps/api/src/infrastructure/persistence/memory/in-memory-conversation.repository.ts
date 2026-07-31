import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Conversation,
  CreateConversationInput,
  UpdateConversationInput,
} from '../../../domain/conversation/conversation.entity';
import {
  ConversationFilter,
  ConversationRepository,
} from '../../../domain/conversation/conversation.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryConversationRepository implements ConversationRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Conversation | null> {
    const conversation = this.store.conversations.get(id);
    return conversation && !conversation.deletedAt ? conversation : null;
  }

  async findByMailboxAndThread(
    mailboxId: string,
    emailThreadId: string,
  ): Promise<Conversation | null> {
    for (const conversation of this.store.conversations.values()) {
      if (
        !conversation.deletedAt &&
        conversation.mailboxId === mailboxId &&
        conversation.emailThreadId === emailThreadId
      ) {
        return conversation;
      }
    }
    return null;
  }

  async findAll(organizationId: string, filter: ConversationFilter = {}): Promise<Conversation[]> {
    const mailboxesById = this.store.mailboxes;
    let results = Array.from(this.store.conversations.values()).filter(
      (conversation) => !conversation.deletedAt && conversation.organizationId === organizationId,
    );

    if (filter.clientId) {
      results = results.filter((c) => c.clientId === filter.clientId);
    }
    if (filter.domainId) {
      results = results.filter((c) => c.domainId === filter.domainId);
    }
    if (filter.mailboxId) {
      results = results.filter((c) => c.mailboxId === filter.mailboxId);
    }
    if (filter.assignedExecutiveId) {
      results = results.filter((c) => c.assignedExecutiveId === filter.assignedExecutiveId);
    }
    if (filter.sequenceId) {
      results = results.filter((c) => c.sequenceId === filter.sequenceId);
    }
    if (filter.sequenceExecutionId) {
      results = results.filter((c) => c.sequenceExecutionId === filter.sequenceExecutionId);
    }
    if (filter.origin) {
      results = results.filter((c) => c.origin === filter.origin);
    }
    if (filter.contactEmail) {
      const needle = filter.contactEmail.toLowerCase();
      results = results.filter((c) => c.contactEmail.toLowerCase() === needle);
    }
    if (filter.dateFrom) {
      const from = new Date(filter.dateFrom).getTime();
      results = results.filter((c) => c.lastMessageAt.getTime() >= from);
    }
    if (filter.dateTo) {
      const to = new Date(filter.dateTo).getTime();
      results = results.filter((c) => c.lastMessageAt.getTime() <= to);
    }
    if (filter.managementStatus) {
      results = results.filter((c) => c.managementStatus === filter.managementStatus);
    }
    if (filter.classification) {
      results = results.filter((c) => c.classification === filter.classification);
    }
    if (filter.responseOutcome === 'UNCLASSIFIED') {
      results = results.filter((c) => c.responseOutcome === null);
    } else if (filter.responseOutcome) {
      results = results.filter((c) => c.responseOutcome === filter.responseOutcome);
    }
    if (filter.isUnread !== undefined) {
      results = results.filter((c) => c.isUnread === filter.isUnread);
    }
    if (filter.tagId) {
      results = results.filter((c) =>
        this.store.conversationTagAssignments.some(
          (a) => a.conversationId === c.id && a.tagId === filter.tagId,
        ),
      );
    }
    if (filter.unmatchedOnly) {
      results = results.filter((c) => {
        const mailbox = mailboxesById.get(c.mailboxId);
        return !mailbox || !mailbox.clientId;
      });
    }
    if (filter.search) {
      const needle = filter.search.toLowerCase();
      results = results.filter(
        (c) =>
          c.subject.toLowerCase().includes(needle) ||
          c.contactEmail.toLowerCase().includes(needle) ||
          (c.contactName ?? '').toLowerCase().includes(needle),
      );
    }

    return results.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: randomUUID(),
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
      origin: input.origin,
      sequenceContactId: input.sequenceContactId ?? null,
      originatingScheduledEmailId: input.originatingScheduledEmailId ?? null,
      sequenceId: input.sequenceId ?? null,
      sequenceStepId: input.sequenceStepId ?? null,
      sequenceExecutionId: input.sequenceExecutionId ?? null,
      prospectImportRowId: input.prospectImportRowId ?? null,
      assignedExecutiveId: input.assignedExecutiveId ?? null,
      subject: input.subject,
      managementStatus: 'NEW',
      classification: input.classification ?? 'UNCLASSIFIED',
      responseOutcome: null,
      isUnread: input.isUnread,
      lastMessageAt: input.lastMessageAt,
      resolvedAt: null,
      resolvedBy: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async update(id: string, input: UpdateConversationInput): Promise<Conversation> {
    const existing = this.store.conversations.get(id);
    if (!existing) {
      throw new NotFoundException('Conversation not found.');
    }
    const updated: Conversation = { ...existing, ...input, updatedAt: new Date() };
    this.store.conversations.set(id, updated);
    return updated;
  }

  async addTag(conversationId: string, tagId: string, appliedBy: string): Promise<void> {
    const already = this.store.conversationTagAssignments.some(
      (a) => a.conversationId === conversationId && a.tagId === tagId,
    );
    if (already) return;
    this.store.conversationTagAssignments.push({
      conversationId,
      tagId,
      appliedBy,
      appliedAt: new Date(),
    });
  }

  async removeTag(conversationId: string, tagId: string): Promise<void> {
    const index = this.store.conversationTagAssignments.findIndex(
      (a) => a.conversationId === conversationId && a.tagId === tagId,
    );
    if (index !== -1) {
      this.store.conversationTagAssignments.splice(index, 1);
    }
  }

  async listTagIds(conversationId: string): Promise<string[]> {
    return this.store.conversationTagAssignments
      .filter((a) => a.conversationId === conversationId)
      .map((a) => a.tagId);
  }
}
