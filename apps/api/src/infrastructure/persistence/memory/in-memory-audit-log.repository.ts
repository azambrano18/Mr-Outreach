import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogEntry, RecordAuditLogInput } from '../../../domain/audit/audit-log.entity';
import { AuditLogFilter, AuditLogRepository } from '../../../domain/audit/audit-log.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryAuditLogRepository implements AuditLogRepository {
  constructor(private readonly store: MemoryStore) {}

  async record(input: RecordAuditLogInput): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: randomUUID(),
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    this.store.auditLogs.push(entry);
    return entry;
  }

  async findAll(organizationId: string, filter?: AuditLogFilter): Promise<AuditLogEntry[]> {
    return this.store.auditLogs.filter(
      (entry) =>
        entry.organizationId === organizationId &&
        (!filter?.actorId || entry.actorId === filter.actorId) &&
        (!filter?.entityType || entry.entityType === filter.entityType) &&
        (!filter?.entityId || entry.entityId === filter.entityId),
    );
  }
}
