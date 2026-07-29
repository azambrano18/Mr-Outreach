import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateIntegrationCommandInput,
  IntegrationCommand,
  UpdateIntegrationCommandInput,
} from '../../../domain/integration/integration-command.entity';
import {
  IntegrationCommandFilter,
  IntegrationCommandRepository,
} from '../../../domain/integration/integration-command.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryIntegrationCommandRepository implements IntegrationCommandRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<IntegrationCommand | null> {
    return this.store.integrationCommands.get(id) ?? null;
  }

  async findByCommandId(
    organizationId: string,
    commandId: string,
  ): Promise<IntegrationCommand | null> {
    for (const command of this.store.integrationCommands.values()) {
      if (command.organizationId === organizationId && command.commandId === commandId) {
        return command;
      }
    }
    return null;
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<IntegrationCommand | null> {
    for (const command of this.store.integrationCommands.values()) {
      if (
        command.organizationId === organizationId &&
        command.idempotencyKey === idempotencyKey
      ) {
        return command;
      }
    }
    return null;
  }

  async findAll(
    organizationId: string,
    filter: IntegrationCommandFilter = {},
  ): Promise<IntegrationCommand[]> {
    let results = Array.from(this.store.integrationCommands.values()).filter(
      (command) => command.organizationId === organizationId,
    );
    if (filter.aggregateType) {
      results = results.filter((c) => c.aggregateType === filter.aggregateType);
    }
    if (filter.aggregateId) {
      results = results.filter((c) => c.aggregateId === filter.aggregateId);
    }
    if (filter.status) {
      results = results.filter((c) => c.status === filter.status);
    }
    if (filter.search) {
      const needle = filter.search.toLowerCase();
      results = results.filter(
        (c) =>
          c.commandId.toLowerCase().includes(needle) ||
          c.correlationId.toLowerCase().includes(needle) ||
          c.aggregateId.toLowerCase().includes(needle),
      );
    }
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create(input: CreateIntegrationCommandInput): Promise<IntegrationCommand> {
    const existing = await this.findByIdempotencyKey(input.organizationId, input.idempotencyKey);
    if (existing) {
      throw new ConflictException('A command with this idempotency key already exists for this organization.');
    }

    const command: IntegrationCommand = {
      id: randomUUID(),
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: input.commandType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      schemaVersion: input.schemaVersion,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      payload: input.payload,
      status: 'REQUESTED',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      requestedBy: input.requestedBy,
      createdAt: new Date(),
      sentAt: null,
      acceptedAt: null,
      completedAt: null,
      payloadHash: input.payloadHash ?? null,
      resultSnapshot: input.resultSnapshot ?? null,
      httpStatusCode: input.httpStatusCode ?? null,
    };
    this.store.integrationCommands.set(command.id, command);
    return command;
  }

  async update(id: string, input: UpdateIntegrationCommandInput): Promise<IntegrationCommand> {
    const existing = this.store.integrationCommands.get(id);
    if (!existing) {
      throw new NotFoundException('Integration command not found.');
    }
    const updated: IntegrationCommand = { ...existing, ...input };
    this.store.integrationCommands.set(id, updated);
    return updated;
  }
}
