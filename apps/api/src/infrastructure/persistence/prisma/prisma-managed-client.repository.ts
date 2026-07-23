import { Injectable } from '@nestjs/common';
import { ManagedClient as PrismaManagedClientRow } from '@prisma/client';
import {
  CreateManagedClientInput,
  ManagedClient,
  UpdateManagedClientInput,
} from '../../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../../domain/client/managed-client.repository';
import { PrismaService } from './prisma.service';

function toDomain(row: PrismaManagedClientRow): ManagedClient {
  return {
    id: row.id,
    organizationId: row.organizationId,
    crmClientId: row.crmClientId,
    name: row.name,
    legalName: row.legalName,
    internalCode: row.internalCode,
    industry: row.industry,
    status: row.status,
    logoUrl: row.logoUrl,
    startDate: row.startDate,
    supervisorUserId: row.supervisorUserId,
    notes: row.notes,
    crmRutSnapshot: row.crmRutSnapshot,
    crmStatusSnapshot: row.crmStatusSnapshot,
    crmStatusCheckedAt: row.crmStatusCheckedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class PrismaManagedClientRepository implements ManagedClientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<ManagedClient | null> {
    const row = await this.prisma.managedClient.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string): Promise<ManagedClient[]> {
    const rows = await this.prisma.managedClient.findMany({
      where: { organizationId, deletedAt: null },
    });
    return rows.map(toDomain);
  }

  async create(input: CreateManagedClientInput): Promise<ManagedClient> {
    const row = await this.prisma.managedClient.create({
      data: {
        organizationId: input.organizationId,
        crmClientId: input.crmClientId,
        name: input.name,
        legalName: input.legalName ?? null,
        internalCode: input.internalCode ?? null,
        industry: input.industry ?? null,
        logoUrl: input.logoUrl ?? null,
        startDate: input.startDate ?? null,
        supervisorUserId: input.supervisorUserId ?? null,
        notes: input.notes ?? null,
        crmRutSnapshot: input.crmRutSnapshot ?? null,
        crmStatusSnapshot: input.crmStatusSnapshot ?? null,
        crmStatusCheckedAt: input.crmStatusCheckedAt ?? null,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateManagedClientInput): Promise<ManagedClient> {
    const row = await this.prisma.managedClient.update({ where: { id }, data: input });
    return toDomain(row);
  }

  async findByCrmClientId(organizationId: string, crmClientId: number): Promise<ManagedClient | null> {
    const row = await this.prisma.managedClient.findFirst({
      where: { organizationId, crmClientId, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }
}
