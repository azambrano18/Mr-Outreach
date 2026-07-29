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
    if (input.crmClientId != null) {
      const existing = await this.findByCrmClientId(input.organizationId, input.crmClientId);
      if (existing) {
        throw new ConflictException('This CRM client is already configured in this organization.');
      }
    }
    if (input.serverClientId) {
      const existing = await this.findByServerClientId(input.organizationId, input.serverClientId);
      if (existing) {
        throw new ConflictException('This server client is already configured in this organization.');
      }
    }

    const now = new Date();
    const client: ManagedClient = {
      id: randomUUID(),
      organizationId: input.organizationId,
      crmClientId: input.crmClientId ?? null,
      source: input.source ?? (input.crmClientId != null ? 'LEGACY_CRM' : 'SERVER'),
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
      crmRutSnapshot: input.crmRutSnapshot ?? null,
      crmStatusSnapshot: input.crmStatusSnapshot ?? null,
      crmStatusCheckedAt: input.crmStatusCheckedAt ?? null,
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

  async findByCrmClientId(organizationId: string, crmClientId: number): Promise<ManagedClient | null> {
    for (const client of this.store.managedClients.values()) {
      if (!client.deletedAt && client.organizationId === organizationId && client.crmClientId === crmClientId) {
        return client;
      }
    }
    return null;
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
