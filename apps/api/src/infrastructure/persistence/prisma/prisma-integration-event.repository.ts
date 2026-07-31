import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, IntegrationEvent as PrismaIntegrationEventRow } from '@prisma/client';
import {
  CreateIntegrationEventInput,
  IntegrationEvent,
  UpdateIntegrationEventInput,
} from '../../../domain/integration/integration-event.entity';
import {
  IntegrationEventFilter,
  IntegrationEventRepository,
} from '../../../domain/integration/integration-event.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaIntegrationEventRow): IntegrationEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventId: row.eventId,
    eventType: row.eventType as IntegrationEvent['eventType'],
    commandId: row.commandId,
    correlationId: row.correlationId,
    schemaVersion: row.schemaVersion,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: row.payload as Record<string, unknown>,
    status: row.status,
    origin: row.origin,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    processingError: row.processingError,
    errorCode: row.errorCode,
    failedAt: row.failedAt,
    attempts: row.attempts,
  };
}

@Injectable()
export class PrismaIntegrationEventRepository implements IntegrationEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, ctx?: TransactionContext): Promise<IntegrationEvent | null> {
    const row = await resolveClient(this.prisma, ctx).integrationEvent.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEventId(
    organizationId: string,
    eventId: string,
    origin: 'SIMULATED' | 'REMOTE',
    ctx?: TransactionContext,
  ): Promise<IntegrationEvent | null> {
    const row = await resolveClient(this.prisma, ctx).integrationEvent.findUnique({
      where: { organizationId_eventId_origin: { organizationId, eventId, origin } },
    });
    return row ? toDomain(row) : null;
  }

  async findAll(
    organizationId: string,
    filter: IntegrationEventFilter = {},
  ): Promise<IntegrationEvent[]> {
    const where: Prisma.IntegrationEventWhereInput = { organizationId };
    if (filter.eventType) where.eventType = filter.eventType;
    if (filter.status) where.status = filter.status as never;
    if (filter.commandId) where.commandId = filter.commandId;
    if (filter.aggregateType) where.aggregateType = filter.aggregateType as never;
    if (filter.aggregateId) where.aggregateId = filter.aggregateId;
    const rows = await this.prisma.integrationEvent.findMany({ where, orderBy: { receivedAt: 'desc' } });
    return rows.map(toDomain);
  }

  async create(input: CreateIntegrationEventInput, ctx?: TransactionContext): Promise<IntegrationEvent> {
    try {
      const row = await resolveClient(this.prisma, ctx).integrationEvent.create({
        data: {
          organizationId: input.organizationId,
          eventId: input.eventId,
          eventType: input.eventType,
          commandId: input.commandId,
          correlationId: input.correlationId,
          schemaVersion: input.schemaVersion,
          aggregateType: input.aggregateType ?? null,
          aggregateId: input.aggregateId ?? null,
          payload: input.payload as Prisma.InputJsonValue,
          origin: input.origin,
          occurredAt: input.occurredAt ?? null,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This event was already recorded for this organization (eventId + origin).');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateIntegrationEventInput, ctx?: TransactionContext): Promise<IntegrationEvent> {
    const row = await resolveClient(this.prisma, ctx).integrationEvent.update({ where: { id }, data: input });
    return toDomain(row);
  }

  async conditionalClaimForProcessing(id: string, ctx?: TransactionContext): Promise<number> {
    const client = resolveClient(this.prisma, ctx);
    const result = await client.integrationEvent.updateMany({
      where: { id, status: { in: ['RECEIVED', 'FAILED_RETRYABLE'] } },
      data: { status: 'PROCESSING' },
    });
    return result.count;
  }
}
