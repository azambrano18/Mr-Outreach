import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
  normalizeCompanyName,
} from '../../../domain/company/company.entity';
import { CompanyRepository } from '../../../domain/company/company.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryCompanyRepository implements CompanyRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Company | null> {
    return this.store.companies.get(id) ?? null;
  }

  async findByNormalizedName(
    organizationId: string,
    clientId: string,
    normalizedName: string,
  ): Promise<Company | null> {
    for (const company of this.store.companies.values()) {
      if (
        !company.deletedAt &&
        company.organizationId === organizationId &&
        company.clientId === clientId &&
        company.normalizedName === normalizedName
      ) {
        return company;
      }
    }
    return null;
  }

  async findByClient(organizationId: string, clientId: string): Promise<Company[]> {
    return Array.from(this.store.companies.values()).filter(
      (company) =>
        !company.deletedAt &&
        company.organizationId === organizationId &&
        company.clientId === clientId,
    );
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    const normalizedName = normalizeCompanyName(input.rawName);
    const existing = await this.findByNormalizedName(input.organizationId, input.clientId, normalizedName);
    if (existing) {
      throw new ConflictException('A company with this normalized name already exists for this client.');
    }

    const now = new Date();
    const company: Company = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      rawName: input.rawName,
      normalizedName: normalizeCompanyName(input.rawName),
      suppressed: false,
      suppressedAt: null,
      suppressedReason: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.companies.set(company.id, company);
    return company;
  }

  async update(id: string, input: UpdateCompanyInput): Promise<Company> {
    const existing = this.store.companies.get(id);
    if (!existing) {
      throw new NotFoundException('Company not found.');
    }
    const updated: Company = { ...existing, ...input, updatedAt: new Date() };
    this.store.companies.set(id, updated);
    return updated;
  }
}
