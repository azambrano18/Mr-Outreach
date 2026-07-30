import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateManagedClientInput,
  ManagedClient,
  UpdateManagedClientInput,
} from '../../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../../domain/client/managed-client.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryManagedClientRepository implements ManagedClientRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<ManagedClient | null> {
    const client = this.store.managedClients.get(id);
    return client && !client.deletedAt ? client : null;
  }

  async findAll(organizationId: string): Promise<ManagedClient[]> {
    return Array.from(this.store.managedClients.values()).filter(
      (client) => !client.deletedAt && client.organizationId === organizationId,
    );
  }

  async create(input: CreateManagedClientInput): Promise<ManagedClient> {
    // serverClientId is globally unique (Fase 2.1 — a single, shared
    // external Railway id space, never scoped per organization), matching
    // the Prisma schema's bare `@unique` (not a composite with
    // organizationId) — mirrored here, not just within this organization.
    if (input.serverClientId) {
      const existing = Array.from(this.store.managedClients.values()).find(
        (client) => !client.deletedAt && client.serverClientId === input.serverClientId,
      );
      if (existing) {
        throw new ConflictException('This server client is already configured.');
      }
    }

    const now = new Date();
    const client: ManagedClient = {
      id: randomUUID(),
      organizationId: input.organizationId,
      source: input.source ?? 'SERVER',
      serverClientId: input.serverClientId ?? null,
      name: input.name,
      legalName: input.legalName ?? null,
      internalCode: input.internalCode ?? null,
      industry: input.industry ?? null,
      status: 'ACTIVE',
      logoUrl: input.logoUrl ?? null,
      startDate: input.startDate ?? null,
      supervisorUserId: input.supervisorUserId ?? null,
      notes: input.notes ?? null,
      clientRutSnapshot: input.clientRutSnapshot ?? null,
      externalStatusSnapshot: input.externalStatusSnapshot ?? null,
      externalStatusCheckedAt: input.externalStatusCheckedAt ?? null,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.managedClients.set(client.id, client);
    return client;
  }

  async update(id: string, input: UpdateManagedClientInput): Promise<ManagedClient> {
    const existing = this.store.managedClients.get(id);
    if (!existing) {
      throw new NotFoundException('Client not found.');
    }
    const updated: ManagedClient = { ...existing, ...input, updatedAt: new Date() };
    this.store.managedClients.set(id, updated);
    return updated;
  }

  async findByServerClientId(organizationId: string, serverClientId: string): Promise<ManagedClient | null> {
    for (const client of this.store.managedClients.values()) {
      if (!client.deletedAt && client.organizationId === organizationId && client.serverClientId === serverClientId) {
        return client;
      }
    }
    return null;
  }
}
