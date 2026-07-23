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
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaIntegrationEventRow): IntegrationEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventId: row.eventId,
    eventType: row.eventType as IntegrationEvent['eventType'],
    commandId: row.commandId,
    correlationId: row.correlationId,
    schemaVersion: row.schemaVersion,
    payload: row.payload as Record<string, unknown>,
    status: row.status,
    origin: row.origin,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    processingError: row.processingError,
  };
}

@Injectable()
export class PrismaIntegrationEventRepository implements IntegrationEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<IntegrationEvent | null> {
    const row = await this.prisma.integrationEvent.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEventId(
    organizationId: string,
    eventId: string,
    origin: 'SIMULATED' | 'REMOTE',
  ): Promise<IntegrationEvent | null> {
    const row = await this.prisma.integrationEvent.findUnique({
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
    const rows = await this.prisma.integrationEvent.findMany({ where, orderBy: { receivedAt: 'desc' } });
    return rows.map(toDomain);
  }

  async create(input: CreateIntegrationEventInput): Promise<IntegrationEvent> {
    try {
      const row = await this.prisma.integrationEvent.create({
        data: {
          organizationId: input.organizationId,
          eventId: input.eventId,
          eventType: input.eventType,
          commandId: input.commandId,
          correlationId: input.correlationId,
          schemaVersion: input.schemaVersion,
          payload: input.payload as Prisma.InputJsonValue,
          origin: input.origin,
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

  async update(id: string, input: UpdateIntegrationEventInput): Promise<IntegrationEvent> {
    const row = await this.prisma.integrationEvent.update({ where: { id }, data: input });
    return toDomain(row);
  }
}
