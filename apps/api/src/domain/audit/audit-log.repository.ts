import { AuditLogEntry, RecordAuditLogInput } from './audit-log.entity';

export interface AuditLogFilter {
  actorId?: string;
  entityType?: string;
  entityId?: string;
}

export interface AuditLogRepository {
  record(input: RecordAuditLogInput): Promise<AuditLogEntry>;
  findAll(organizationId: string, filter?: AuditLogFilter): Promise<AuditLogEntry[]>;
}
