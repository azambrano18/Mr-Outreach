import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateOrganizationInput,
  Organization,
} from '../../../domain/organization/organization.entity';
import { OrganizationRepository } from '../../../domain/organization/organization.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryOrganizationRepository implements OrganizationRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Organization | null> {
    const org = this.store.organizations.get(id);
    return org && !org.deletedAt ? org : null;
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const now = new Date();
    const organization: Organization = {
      id: randomUUID(),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.organizations.set(organization.id, organization);
    return organization;
  }
}
