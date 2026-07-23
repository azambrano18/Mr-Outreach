import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, IntegrationCommand as PrismaIntegrationCommandRow } from '@prisma/client';
import {
  CreateIntegrationCommandInput,
  IntegrationCommand,
  UpdateIntegrationCommandInput,
} from '../../../domain/integration/integration-command.entity';
import {
  IntegrationCommandFilter,
  IntegrationCommandRepository,
} from '../../../domain/integration/integration-command.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaIntegrationCommandRow): IntegrationCommand {
  return {
    id: row.id,
    organizationId: row.organizationId,
    commandId: row.commandId,
    commandType: row.commandType as IntegrationCommand['commandType'],
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    schemaVersion: row.schemaVersion,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    payload: row.payload as Record<string, unknown>,
    status: row.status,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    acceptedAt: row.acceptedAt,
    completedAt: row.completedAt,
  };
}

@Injectable()
export class PrismaIntegrationCommandRepository implements IntegrationCommandRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<IntegrationCommand | null> {
    const row = await this.prisma.integrationCommand.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByCommandId(organizationId: string, commandId: string): Promise<IntegrationCommand | null> {
    const row = await this.prisma.integrationCommand.findFirst({ where: { organizationId, commandId } });
    return row ? toDomain(row) : null;
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<IntegrationCommand | null> {
    const row = await this.prisma.integrationCommand.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    return row ? toDomain(row) : null;
  }

  async findAll(
    organizationId: string,
    filter: IntegrationCommandFilter = {},
  ): Promise<IntegrationCommand[]> {
    const where: Prisma.IntegrationCommandWhereInput = { organizationId };
    if (filter.aggregateType) where.aggregateType = filter.aggregateType as never;
    if (filter.aggregateId) where.aggregateId = filter.aggregateId;
    if (filter.status) where.status = filter.status as never;
    if (filter.search) {
      const needle = filter.search;
      where.OR = [
        { commandId: { contains: needle, mode: 'insensitive' } },
        { correlationId: { contains: needle, mode: 'insensitive' } },
        { aggregateId: { contains: needle, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.integrationCommand.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map(toDomain);
  }

  async create(input: CreateIntegrationCommandInput): Promise<IntegrationCommand> {
    try {
      const row = await this.prisma.integrationCommand.create({
        data: {
          organizationId: input.organizationId,
          commandId: input.commandId,
          commandType: input.commandType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          schemaVersion: input.schemaVersion,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          payload: input.payload as Prisma.InputJsonValue,
          requestedBy: input.requestedBy,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A command with this idempotency key already exists for this organization.');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateIntegrationCommandInput): Promise<IntegrationCommand> {
    const row = await this.prisma.integrationCommand.update({ where: { id }, data: input });
    return toDomain(row);
  }
}
