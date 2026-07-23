import { InMemoryAuditLogRepository } from './in-memory-audit-log.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryAuditLogRepository', () => {
  it('records an entry and scopes findAll to the given organization', async () => {
    const store = new MemoryStore();
    const repo = new InMemoryAuditLogRepository(store);

    await repo.record({
      organizationId: 'org_1',
      actorId: 'user_1',
      action: 'auth.login',
      entityType: 'User',
      entityId: 'user_1',
    });
    await repo.record({
      organizationId: 'org_2',
      actorId: 'user_2',
      action: 'auth.login',
      entityType: 'User',
      entityId: 'user_2',
    });

    const orgOneEntries = await repo.findAll('org_1');

    expect(orgOneEntries).toHaveLength(1);
    expect(orgOneEntries[0].actorId).toBe('user_1');
  });

  it('defaults metadata to an empty object when none is given', async () => {
    const repo = new InMemoryAuditLogRepository(new MemoryStore());

    const entry = await repo.record({
      organizationId: 'org_1',
      actorId: null,
      action: 'auth.login',
      entityType: 'User',
      entityId: 'user_1',
    });

    expect(entry.metadata).toEqual({});
  });
});
