import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CANCELLABLE_SCHEDULED_EMAIL_STATUSES,
  CreateScheduledEmailInput,
  ScheduledEmail,
  UpdateScheduledEmailInput,
} from '../../../domain/scheduled-email/scheduled-email.entity';
import {
  ScheduledEmailFilter,
  ScheduledEmailRepository,
} from '../../../domain/scheduled-email/scheduled-email.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryScheduledEmailRepository implements ScheduledEmailRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<ScheduledEmail | null> {
    return this.store.scheduledEmails.get(id) ?? null;
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<ScheduledEmail | null> {
    for (const row of this.store.scheduledEmails.values()) {
      if (row.organizationId === organizationId && row.idempotencyKey === idempotencyKey) {
        return row;
      }
    }
    return null;
  }

  async findBySequenceContact(sequenceContactId: string): Promise<ScheduledEmail[]> {
    return Array.from(this.store.scheduledEmails.values())
      .filter((row) => row.sequenceContactId === sequenceContactId)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  async findManyBySequenceContactIds(sequenceContactIds: string[]): Promise<ScheduledEmail[]> {
    const ids = new Set(sequenceContactIds);
    return Array.from(this.store.scheduledEmails.values()).filter((row) => ids.has(row.sequenceContactId));
  }

  async findAll(
    organizationId: string,
    filter: ScheduledEmailFilter = {},
  ): Promise<ScheduledEmail[]> {
    let results = Array.from(this.store.scheduledEmails.values()).filter(
      (row) => row.organizationId === organizationId,
    );
    if (filter.status) results = results.filter((row) => row.status === filter.status);
    if (filter.sequenceContactId) {
      results = results.filter((row) => row.sequenceContactId === filter.sequenceContactId);
    }
    if (filter.mailboxId) results = results.filter((row) => row.mailboxId === filter.mailboxId);
    if (filter.batchId) results = results.filter((row) => row.batchId === filter.batchId);
    if (filter.sequenceId) results = results.filter((row) => row.sequenceId === filter.sequenceId);
    if (filter.companyId) results = results.filter((row) => row.companyId === filter.companyId);
    return results.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  async create(input: CreateScheduledEmailInput): Promise<ScheduledEmail> {
    const existing = await this.findByIdempotencyKey(input.organizationId, input.idempotencyKey);
    if (existing) {
      throw new ConflictException('A scheduled email with this idempotency key already exists for this organization.');
    }

    const now = new Date();
    const row: ScheduledEmail = {
      id: randomUUID(),
      organizationId: input.organizationId,
      sequenceId: input.sequenceId,
      sequenceVersion: input.sequenceVersion,
      sequenceContactId: input.sequenceContactId,
      contactId: input.contactId,
      companyId: input.companyId,
      sequenceStepId: input.sequenceStepId,
      stepVersion: input.stepVersion,
      mailboxId: input.mailboxId,
      batchId: input.batchId,
      scheduledAt: input.scheduledAt,
      status: 'PENDING',
      priority: input.priority,
      attemptCount: 0,
      idempotencyKey: input.idempotencyKey,
      lastError: null,
      cancelledAt: null,
      cancellationReason: null,
      sentAt: null,
      subjectSnapshot: null,
      htmlBodySnapshot: null,
      plainTextBodySnapshot: null,
      signatureSnapshot: null,
      messageIdHeader: null,
      inReplyTo: null,
      referencesHeader: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.scheduledEmails.set(row.id, row);
    return row;
  }

  async createMany(inputs: Array<CreateScheduledEmailInput & { id: string }>): Promise<ScheduledEmail[]> {
    const now = new Date();
    const rows = inputs.map((input) => ({
      id: input.id,
      organizationId: input.organizationId,
      sequenceId: input.sequenceId,
      sequenceVersion: input.sequenceVersion,
      sequenceContactId: input.sequenceContactId,
      contactId: input.contactId,
      companyId: input.companyId,
      sequenceStepId: input.sequenceStepId,
      stepVersion: input.stepVersion,
      mailboxId: input.mailboxId,
      batchId: input.batchId,
      scheduledAt: input.scheduledAt,
      status: 'PENDING' as const,
      priority: input.priority,
      attemptCount: 0,
      idempotencyKey: input.idempotencyKey,
      lastError: null,
      cancelledAt: null,
      cancellationReason: null,
      sentAt: null,
      subjectSnapshot: null,
      htmlBodySnapshot: null,
      plainTextBodySnapshot: null,
      signatureSnapshot: null,
      messageIdHeader: null,
      inReplyTo: null,
      referencesHeader: null,
      createdAt: now,
      updatedAt: now,
    }));
    for (const row of rows) this.store.scheduledEmails.set(row.id, row);
    return rows;
  }

  async update(id: string, input: UpdateScheduledEmailInput): Promise<ScheduledEmail> {
    const existing = this.store.scheduledEmails.get(id);
    if (!existing) {
      throw new NotFoundException('Scheduled email not found.');
    }
    const updated: ScheduledEmail = { ...existing, ...input, updatedAt: new Date() };
    this.store.scheduledEmails.set(id, updated);
    return updated;
  }

  async cancelFutureForSequenceContact(sequenceContactId: string, reason: string): Promise<number> {
    let count = 0;
    for (const row of this.store.scheduledEmails.values()) {
      if (row.sequenceContactId === sequenceContactId && CANCELLABLE_SCHEDULED_EMAIL_STATUSES.includes(row.status)) {
        this.store.scheduledEmails.set(row.id, {
          ...row,
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedAt: new Date(),
        });
        count += 1;
      }
    }
    return count;
  }

  async cancelFutureForSequenceCompany(sequenceId: string, companyId: string, reason: string): Promise<number> {
    let count = 0;
    for (const row of this.store.scheduledEmails.values()) {
      if (
        row.sequenceId === sequenceId &&
        row.companyId === companyId &&
        CANCELLABLE_SCHEDULED_EMAIL_STATUSES.includes(row.status)
      ) {
        this.store.scheduledEmails.set(row.id, {
          ...row,
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedAt: new Date(),
        });
        count += 1;
      }
    }
    return count;
  }

  async cancelFutureForMailbox(mailboxId: string, reason: string): Promise<number> {
    let count = 0;
    for (const row of this.store.scheduledEmails.values()) {
      if (row.mailboxId === mailboxId && CANCELLABLE_SCHEDULED_EMAIL_STATUSES.includes(row.status)) {
        this.store.scheduledEmails.set(row.id, {
          ...row,
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedAt: new Date(),
        });
        count += 1;
      }
    }
    return count;
  }
}
