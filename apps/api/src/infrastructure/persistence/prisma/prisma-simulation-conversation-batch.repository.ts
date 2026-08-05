import { Injectable } from '@nestjs/common';
import { SimulationConversationBatch as PrismaSimulationConversationBatchRow, Prisma } from '@prisma/client';
import {
  CreateSimulationConversationBatchInput,
  SimulationConversationBatch,
} from '../../../domain/simulation-conversation/simulation-conversation-batch.entity';
import { SimulationConversationBatchRepository } from '../../../domain/simulation-conversation/simulation-conversation-batch.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaSimulationConversationBatchRow): SimulationConversationBatch {
  return {
    id: row.id,
    organizationId: row.organizationId,
    mailboxId: row.mailboxId,
    createdByUserId: row.createdByUserId,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

@Injectable()
export class PrismaSimulationConversationBatchRepository implements SimulationConversationBatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, ctx?: TransactionContext): Promise<SimulationConversationBatch | null> {
    const row = await resolveClient(this.prisma, ctx).simulationConversationBatch.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<SimulationConversationBatch | null> {
    const row = await this.prisma.simulationConversationBatch.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    return row ? toDomain(row) : null;
  }

  async findActiveByOrganization(organizationId: string): Promise<SimulationConversationBatch | null> {
    const row = await this.prisma.simulationConversationBatch.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async create(input: CreateSimulationConversationBatchInput, ctx?: TransactionContext): Promise<SimulationConversationBatch> {
    const row = await resolveClient(this.prisma, ctx).simulationConversationBatch.create({
      data: {
        organizationId: input.organizationId,
        mailboxId: input.mailboxId,
        createdByUserId: input.createdByUserId,
        idempotencyKey: input.idempotencyKey,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return toDomain(row);
  }

  async delete(id: string, ctx?: TransactionContext): Promise<void> {
    await resolveClient(this.prisma, ctx).simulationConversationBatch.delete({ where: { id } });
  }
}
