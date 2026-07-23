import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateDomainInput,
  Domain,
  UpdateDomainInput,
} from '../../../domain/domain-entity/domain.entity';
import { DomainRepository } from '../../../domain/domain-entity/domain.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryDomainRepository implements DomainRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Domain | null> {
    const domain = this.store.domains.get(id);
    return domain && !domain.deletedAt ? domain : null;
  }

  async findByClient(organizationId: string, clientId: string): Promise<Domain[]> {
    return Array.from(this.store.domains.values()).filter(
      (domain) =>
        !domain.deletedAt &&
        domain.organizationId === organizationId &&
        domain.clientId === clientId,
    );
  }

  async findByName(organizationId: string, domainName: string): Promise<Domain | null> {
    const normalized = domainName.toLowerCase();
    for (const domain of this.store.domains.values()) {
      if (
        !domain.deletedAt &&
        domain.organizationId === organizationId &&
        domain.domainName.toLowerCase() === normalized
      ) {
        return domain;
      }
    }
    return null;
  }

  async findAll(organizationId: string): Promise<Domain[]> {
    return Array.from(this.store.domains.values()).filter(
      (domain) => !domain.deletedAt && domain.organizationId === organizationId,
    );
  }

  async create(input: CreateDomainInput): Promise<Domain> {
    const now = new Date();
    const domain: Domain = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      domainName: input.domainName,
      status: 'ACTIVE',
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.domains.set(domain.id, domain);
    return domain;
  }

  async update(id: string, input: UpdateDomainInput): Promise<Domain> {
    const existing = this.store.domains.get(id);
    if (!existing) {
      throw new NotFoundException('Domain not found.');
    }
    const updated: Domain = { ...existing, ...input, updatedAt: new Date() };
    this.store.domains.set(id, updated);
    return updated;
  }
}
