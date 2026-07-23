import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateIntegrationEventInput,
  IntegrationEvent,
  UpdateIntegrationEventInput,
} from '../../../domain/integration/integration-event.entity';
import {
  IntegrationEventFilter,
  IntegrationEventRepository,
} from '../../../domain/integration/integration-event.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryIntegrationEventRepository implements IntegrationEventRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<IntegrationEvent | null> {
    return this.store.integrationEvents.get(id) ?? null;
  }

  async findByEventId(
    organizationId: string,
    eventId: string,
    origin: 'SIMULATED' | 'REMOTE',
  ): Promise<IntegrationEvent | null> {
    for (const event of this.store.integrationEvents.values()) {
      if (
        event.organizationId === organizationId &&
        event.eventId === eventId &&
        event.origin === origin
      ) {
        return event;
      }
    }
    return null;
  }

  async findAll(
    organizationId: string,
    filter: IntegrationEventFilter = {},
  ): Promise<IntegrationEvent[]> {
    let results = Array.from(this.store.integrationEvents.values()).filter(
      (event) => event.organizationId === organizationId,
    );
    if (filter.eventType) {
      results = results.filter((e) => e.eventType === filter.eventType);
    }
    if (filter.status) {
      results = results.filter((e) => e.status === filter.status);
    }
    if (filter.commandId) {
      results = results.filter((e) => e.commandId === filter.commandId);
    }
    return results.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  }

  async create(input: CreateIntegrationEventInput): Promise<IntegrationEvent> {
    const existing = await this.findByEventId(input.organizationId, input.eventId, input.origin);
    if (existing) {
      throw new ConflictException('This event was already recorded for this organization (eventId + origin).');
    }

    const event: IntegrationEvent = {
      id: randomUUID(),
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventType: input.eventType,
      commandId: input.commandId,
      correlationId: input.correlationId,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      status: 'RECEIVED',
      origin: input.origin,
      receivedAt: new Date(),
      processedAt: null,
      processingError: null,
    };
    this.store.integrationEvents.set(event.id, event);
    return event;
  }

  async update(id: string, input: UpdateIntegrationEventInput): Promise<IntegrationEvent> {
    const existing = this.store.integrationEvents.get(id);
    if (!existing) {
      throw new NotFoundException('Integration event not found.');
    }
    const updated: IntegrationEvent = { ...existing, ...input };
    this.store.integrationEvents.set(id, updated);
    return updated;
  }
}
