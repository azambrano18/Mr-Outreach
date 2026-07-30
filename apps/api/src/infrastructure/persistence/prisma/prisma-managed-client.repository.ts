import { Injectable } from '@nestjs/common';
import { ManagedClient as PrismaManagedClientRow } from '@prisma/client';
import {
  CreateManagedClientInput,
  ManagedClient,
  UpdateManagedClientInput,
} from '../../../domain/client/managed-client.entity';
import { ManagedClientRepository } from '../../../domain/client/managed-client.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

function toDomain(row: PrismaManagedClientRow): ManagedClient {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    serverClientId: row.serverClientId,
    name: row.name,
    legalName: row.legalName,
    internalCode: row.internalCode,
    industry: row.industry,
    status: row.status,
    logoUrl: row.logoUrl,
    startDate: row.startDate,
    supervisorUserId: row.supervisorUserId,
    notes: row.notes,
    clientRutSnapshot: row.clientRutSnapshot,
    externalStatusSnapshot: row.externalStatusSnapshot,
    externalStatusCheckedAt: row.externalStatusCheckedAt,
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

  async findById(id: string, ctx?: TransactionContext): Promise<ManagedClient | null> {
    const row = await resolveClient(this.prisma, ctx).managedClient.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findAll(organizationId: string): Promise<ManagedClient[]> {
    const rows = await this.prisma.managedClient.findMany({
      where: { organizationId, deletedAt: null },
    });
    return rows.map(toDomain);
  }

  async create(input: CreateManagedClientInput, ctx?: TransactionContext): Promise<ManagedClient> {
    const row = await resolveClient(this.prisma, ctx).managedClient.create({
      data: {
        organizationId: input.organizationId,
        source: input.source ?? 'SERVER',
        serverClientId: input.serverClientId ?? null,
        name: input.name,
        legalName: input.legalName ?? null,
        internalCode: input.internalCode ?? null,
        industry: input.industry ?? null,
        logoUrl: input.logoUrl ?? null,
        startDate: input.startDate ?? null,
        supervisorUserId: input.supervisorUserId ?? null,
        notes: input.notes ?? null,
        clientRutSnapshot: input.clientRutSnapshot ?? null,
        externalStatusSnapshot: input.externalStatusSnapshot ?? null,
        externalStatusCheckedAt: input.externalStatusCheckedAt ?? null,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      },
    });
    return toDomain(row);
  }

  async update(id: string, input: UpdateManagedClientInput, ctx?: TransactionContext): Promise<ManagedClient> {
    const row = await resolveClient(this.prisma, ctx).managedClient.update({ where: { id }, data: input });
    return toDomain(row);
  }

  async findByServerClientId(
    organizationId: string,
    serverClientId: string,
    ctx?: TransactionContext,
  ): Promise<ManagedClient | null> {
    const row = await resolveClient(this.prisma, ctx).managedClient.findFirst({
      where: { organizationId, serverClientId, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }
}
