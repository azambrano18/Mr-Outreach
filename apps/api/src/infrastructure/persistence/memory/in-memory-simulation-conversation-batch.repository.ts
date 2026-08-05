import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateSimulationConversationBatchInput,
  SimulationConversationBatch,
} from '../../../domain/simulation-conversation/simulation-conversation-batch.entity';
import { SimulationConversationBatchRepository } from '../../../domain/simulation-conversation/simulation-conversation-batch.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemorySimulationConversationBatchRepository implements SimulationConversationBatchRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<SimulationConversationBatch | null> {
    return this.store.simulationConversationBatches.get(id) ?? null;
  }

  async findByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<SimulationConversationBatch | null> {
    for (const batch of this.store.simulationConversationBatches.values()) {
      if (batch.organizationId === organizationId && batch.idempotencyKey === idempotencyKey) return batch;
    }
    return null;
  }

  async findActiveByOrganization(organizationId: string): Promise<SimulationConversationBatch | null> {
    for (const batch of this.store.simulationConversationBatches.values()) {
      if (batch.organizationId === organizationId) return batch;
    }
    return null;
  }

  async create(input: CreateSimulationConversationBatchInput): Promise<SimulationConversationBatch> {
    const batch: SimulationConversationBatch = {
      id: randomUUID(),
      organizationId: input.organizationId,
      mailboxId: input.mailboxId,
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date(),
      metadata: input.metadata ?? null,
    };
    this.store.simulationConversationBatches.set(batch.id, batch);
    return batch;
  }

  async delete(id: string): Promise<void> {
    this.store.simulationConversationBatches.delete(id);
  }
}
