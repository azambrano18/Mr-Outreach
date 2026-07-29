import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, ScheduledEmail as PrismaScheduledEmailRow } from '@prisma/client';
import { TransactionContext } from '../../../domain/persistence/transaction';
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
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaScheduledEmailRow): ScheduledEmail {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sequenceId: row.sequenceId,
    sequenceVersion: row.sequenceVersion,
    sequenceContactId: row.sequenceContactId,
    contactId: row.contactId,
    companyId: row.companyId,
    sequenceStepId: row.sequenceStepId,
    stepVersion: row.stepVersion,
    mailboxId: row.mailboxId,
    batchId: row.batchId,
    scheduledAt: row.scheduledAt,
    status: row.status,
    priority: row.priority,
    attemptCount: row.attemptCount,
    idempotencyKey: row.idempotencyKey,
    lastError: row.lastError,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    sentAt: row.sentAt,
    subjectSnapshot: row.subjectSnapshot,
    htmlBodySnapshot: row.htmlBodySnapshot,
    plainTextBodySnapshot: row.plainTextBodySnapshot,
    signatureSnapshot: row.signatureSnapshot,
    messageIdHeader: row.messageIdHeader,
    inReplyTo: row.inReplyTo,
    referencesHeader: row.referencesHeader,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaScheduledEmailRepository implements ScheduledEmailRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<ScheduledEmail | null> {
    const row = await this.prisma.scheduledEmail.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<ScheduledEmail | null> {
    const row = await this.prisma.scheduledEmail.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    return row ? toDomain(row) : null;
  }

  async findBySequenceContact(sequenceContactId: string): Promise<ScheduledEmail[]> {
    const rows = await this.prisma.scheduledEmail.findMany({
      where: { sequenceContactId },
      orderBy: { scheduledAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findManyBySequenceContactIds(
    sequenceContactIds: string[],
    ctx?: TransactionContext,
  ): Promise<ScheduledEmail[]> {
    if (sequenceContactIds.length === 0) return [];
    const client = resolveClient(this.prisma, ctx);
    const rows = await client.scheduledEmail.findMany({
      where: { sequenceContactId: { in: sequenceContactIds } },
    });
    return rows.map(toDomain);
  }

  async findAll(
    organizationId: string,
    filter: ScheduledEmailFilter = {},
    ctx?: TransactionContext,
  ): Promise<ScheduledEmail[]> {
    const client = resolveClient(this.prisma, ctx);
    const where: Prisma.ScheduledEmailWhereInput = { organizationId };
    if (filter.status) where.status = filter.status as never;
    if (filter.sequenceContactId) where.sequenceContactId = filter.sequenceContactId;
    if (filter.mailboxId) where.mailboxId = filter.mailboxId;
    if (filter.batchId) where.batchId = filter.batchId;
    if (filter.sequenceId) where.sequenceId = filter.sequenceId;
    if (filter.companyId) where.companyId = filter.companyId;
    const rows = await client.scheduledEmail.findMany({ where, orderBy: { scheduledAt: 'asc' } });
    return rows.map(toDomain);
  }

  async create(input: CreateScheduledEmailInput, ctx?: TransactionContext): Promise<ScheduledEmail> {
    const client = resolveClient(this.prisma, ctx);
    try {
      const row = await client.scheduledEmail.create({
        data: {
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
          priority: input.priority,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A scheduled email with this idempotency key already exists for this organization.');
      }
      throw error;
    }
  }

  async createMany(
    inputs: Array<CreateScheduledEmailInput & { id: string }>,
    ctx?: TransactionContext,
  ): Promise<ScheduledEmail[]> {
    if (inputs.length === 0) return [];
    const client = resolveClient(this.prisma, ctx);
    const now = new Date();
    await client.scheduledEmail.createMany({
      data: inputs.map((input) => ({
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
        priority: input.priority,
        idempotencyKey: input.idempotencyKey,
      })),
    });
    return inputs.map((input) => ({
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
    }));
  }

  async update(id: string, input: UpdateScheduledEmailInput): Promise<ScheduledEmail> {
    const row = await this.prisma.scheduledEmail.update({ where: { id }, data: input });
    return toDomain(row);
  }

  async cancelFutureForSequenceContact(
    sequenceContactId: string,
    reason: string,
    ctx?: TransactionContext,
  ): Promise<number> {
    const client = resolveClient(this.prisma, ctx);
    const result = await client.scheduledEmail.updateMany({
      where: { sequenceContactId, status: { in: CANCELLABLE_SCHEDULED_EMAIL_STATUSES } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
    });
    return result.count;
  }

  async cancelFutureForSequenceCompany(
    sequenceId: string,
    companyId: string,
    reason: string,
    ctx?: TransactionContext,
  ): Promise<number> {
    const client = resolveClient(this.prisma, ctx);
    const result = await client.scheduledEmail.updateMany({
      where: { sequenceId, companyId, status: { in: CANCELLABLE_SCHEDULED_EMAIL_STATUSES } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
    });
    return result.count;
  }

  async cancelFutureForMailbox(mailboxId: string, reason: string, ctx?: TransactionContext): Promise<number> {
    const client = resolveClient(this.prisma, ctx);
    const result = await client.scheduledEmail.updateMany({
      where: { mailboxId, status: { in: CANCELLABLE_SCHEDULED_EMAIL_STATUSES } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
    });
    return result.count;
  }
}
