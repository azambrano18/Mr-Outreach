import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogEntry, RecordAuditLogInput } from '../../../domain/audit/audit-log.entity';
import { AuditLogFilter, AuditLogRepository } from '../../../domain/audit/audit-log.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput): Promise<AuditLogEntry> {
    const entry = await this.prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    return { ...entry, metadata: entry.metadata as Record<string, unknown> };
  }

  async findAll(organizationId: string, filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        ...(filter?.actorId ? { actorId: filter.actorId } : {}),
        ...(filter?.entityType ? { entityType: filter.entityType } : {}),
        ...(filter?.entityId ? { entityId: filter.entityId } : {}),
      },
    });
    return entries.map((entry) => ({
      ...entry,
      metadata: entry.metadata as Record<string, unknown>,
    }));
  }
}
