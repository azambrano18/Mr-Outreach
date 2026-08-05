import { Injectable } from '@nestjs/common';
import { Sequence as PrismaSequenceRow } from '@prisma/client';
import { TransactionContext } from '../../../domain/persistence/transaction';
import {
  CreateSequenceInput,
  Sequence,
  SequencePublishStatus,
  SequenceStatus,
  UpdateSequenceInput,
} from '../../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../../domain/sequence/sequence.repository';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaSequenceRow): Sequence {
  return {
    id: row.id,
    organizationId: row.organizationId,
    executiveId: row.executiveId,
    mailboxId: row.mailboxId,
    clientId: row.clientId,
    name: row.name,
    description: row.description,
    status: row.status as SequenceStatus,
    timezone: row.timezone,
    // schedule/managementDate/stepPolicy still have no column under this driver.
    schedule: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], windows: [{ start: '09:00', end: '18:00' }] },
    policies: {
      stopOnReply: true,
      stopOnHardBounce: true,
      stopOnUnsubscribe: true,
      prioritizeFollowUps: true,
    },
    // Wizard fields (managementDate/stepPolicy) still have no migration
    // under this driver — same gap as schedule above.
    managementDate: null,
    stepPolicy: 'FLEXIBLE',
    // Fase 2 — real columns as of the sequence-publish-state migration.
    publishStatus: row.publishStatus as SequencePublishStatus | null,
    effectiveStartAt: row.effectiveStartAt,
    sequenceVersion: row.sequenceVersion,
    lastPublishedAt: row.lastPublishedAt,
    lastPublishCommandId: row.lastPublishCommandId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaSequenceRepository implements SequenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, ctx?: TransactionContext): Promise<Sequence | null> {
    const client = resolveClient(this.prisma, ctx);
    const row = await client.sequence.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByExecutive(organizationId: string, executiveId: string): Promise<Sequence[]> {
    const rows = await this.prisma.sequence.findMany({
      where: { organizationId, executiveId, deletedAt: null },
    });
    return rows.map(toDomain);
  }

  async findByClient(organizationId: string, clientId: string): Promise<Sequence[]> {
    const rows = await this.prisma.sequence.findMany({
      where: { organizationId, clientId, deletedAt: null },
    });
    return rows.map(toDomain);
  }

  async findAllByOrganization(organizationId: string): Promise<Sequence[]> {
    const rows = await this.prisma.sequence.findMany({ where: { organizationId, deletedAt: null } });
    return rows.map(toDomain);
  }

  async create(input: CreateSequenceInput): Promise<Sequence> {
    const row = await this.prisma.sequence.create({
      data: {
        organizationId: input.organizationId,
        executiveId: input.executiveId,
        name: input.name,
        description: input.description ?? null,
        timezone: input.timezone,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateSequenceInput, ctx?: TransactionContext): Promise<Sequence> {
    const client = resolveClient(this.prisma, ctx);
    const row = await client.sequence.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        timezone: input.timezone,
        executiveId: input.executiveId,
        mailboxId: input.mailboxId,
        clientId: input.clientId,
        status: input.status,
        updatedBy: input.updatedBy,
        deletedAt: input.deletedAt,
        publishStatus: input.publishStatus,
        sequenceVersion: input.sequenceVersion,
        effectiveStartAt: input.effectiveStartAt,
        lastPublishedAt: input.lastPublishedAt,
        lastPublishCommandId: input.lastPublishCommandId,
      },
    });
    return toDomain(row);
  }

  async conditionalUpdatePublishStatus(
    id: string,
    blockedStatuses: SequencePublishStatus[],
    toStatus: SequencePublishStatus,
    ctx?: TransactionContext,
  ): Promise<number> {
    const client = resolveClient(this.prisma, ctx);
    // Explicit `OR` with a bare null check — Postgres's three-valued logic
    // means `NOT (publishStatus IN (...))` silently excludes rows where
    // publishStatus IS NULL, which must remain claimable (never published).
    const result = await client.sequence.updateMany({
      where: {
        id,
        deletedAt: null,
        OR: [{ publishStatus: null }, { publishStatus: { notIn: blockedStatuses } }],
      },
      data: { publishStatus: toStatus },
    });
    return result.count;
  }

  async delete(id: string, ctx?: TransactionContext): Promise<void> {
    await resolveClient(this.prisma, ctx).sequence.delete({ where: { id } });
  }
}
