import { Injectable } from '@nestjs/common';
import { Domain as PrismaDomainRow } from '@prisma/client';
import { CreateDomainInput, Domain, UpdateDomainInput } from '../../../domain/domain-entity/domain.entity';
import { DomainRepository } from '../../../domain/domain-entity/domain.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaDomainRow): Domain {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    domainName: row.domainName,
    status: row.status,
    notes: row.notes,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaDomainRepository implements DomainRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Domain | null> {
    const row = await this.prisma.domain.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByClient(organizationId: string, clientId: string): Promise<Domain[]> {
    const rows = await this.prisma.domain.findMany({
      where: { organizationId, clientId, deletedAt: null },
    });
    return rows.map(toDomain);
  }

  async findByName(organizationId: string, domainName: string): Promise<Domain | null> {
    const row = await this.prisma.domain.findFirst({
      where: { organizationId, domainName: { equals: domainName, mode: 'insensitive' }, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string): Promise<Domain[]> {
    const rows = await this.prisma.domain.findMany({ where: { organizationId, deletedAt: null } });
    return rows.map(toDomain);
  }

  async create(input: CreateDomainInput): Promise<Domain> {
    const row = await this.prisma.domain.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        domainName: input.domainName,
        notes: input.notes ?? null,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateDomainInput): Promise<Domain> {
    const row = await this.prisma.domain.update({ where: { id }, data: input });
    return toDomain(row);
  }
}
