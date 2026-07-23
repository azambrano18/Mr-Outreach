import { Injectable } from '@nestjs/common';
import { Sequence as PrismaSequenceRow } from '@prisma/client';
import {
  CreateSequenceInput,
  Sequence,
  SequenceStatus,
  UpdateSequenceInput,
} from '../../../domain/sequence/sequence.entity';
import { SequenceRepository } from '../../../domain/sequence/sequence.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaSequenceRow): Sequence {
  return {
    id: row.id,
    organizationId: row.organizationId,
    executiveId: row.executiveId,
    mailboxId: row.mailboxId,
    // Same caveat as PrismaMailboxRepository — the Postgres driver doesn't
    // model the client hierarchy yet, so this always reads null under it.
    clientId: null,
    name: row.name,
    description: row.description,
    status: row.status as SequenceStatus,
    timezone: row.timezone,
    // Same "not yet modeled under Postgres" gap as clientId above — the
    // mail-engine simulation phase's publish fields have no migration yet.
    schedule: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], windows: [{ start: '09:00', end: '18:00' }] },
    policies: {
      stopOnReply: true,
      stopOnHardBounce: true,
      stopOnUnsubscribe: true,
      prioritizeFollowUps: true,
    },
    // Wizard fields (managementDate/stepPolicy/publishStatus) have no
    // migration under this driver yet — same gap as clientId/schedule above.
    managementDate: null,
    stepPolicy: 'FLEXIBLE',
    publishStatus: null,
    effectiveStartAt: null,
    sequenceVersion: 0,
    lastPublishedAt: null,
    lastPublishCommandId: null,
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

  async findById(id: string): Promise<Sequence | null> {
    const row = await this.prisma.sequence.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByExecutive(organizationId: string, executiveId: string): Promise<Sequence[]> {
    const rows = await this.prisma.sequence.findMany({
      where: { organizationId, executiveId, deletedAt: null },
    });
    return rows.map(toDomain);
  }

  async findByClient(): Promise<Sequence[]> {
    // No clientId column under the Postgres driver yet — see toDomain().
    return [];
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

  async update(id: string, input: UpdateSequenceInput): Promise<Sequence> {
    // clientId has no column under this driver yet (see toDomain) — never
    // forward it to Prisma, which would reject an unknown field.
    const row = await this.prisma.sequence.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        timezone: input.timezone,
        executiveId: input.executiveId,
        mailboxId: input.mailboxId,
        status: input.status,
        updatedBy: input.updatedBy,
        deletedAt: input.deletedAt,
      },
    });
    return toDomain(row);
  }
}
