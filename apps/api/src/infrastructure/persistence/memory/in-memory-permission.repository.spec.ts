import { InMemoryPermissionRepository } from './in-memory-permission.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryPermissionRepository', () => {
  it('loads the catalog via upsertMany and finds entries by key', async () => {
    const repo = new InMemoryPermissionRepository(new MemoryStore());

    await repo.upsertMany([
      { key: 'users.read', description: 'View users.' },
      { key: 'users.create', description: 'Create users.' },
    ]);

    expect(await repo.findAll()).toHaveLength(2);
    expect((await repo.findByKey('users.read'))?.description).toBe('View users.');
    expect(await repo.findByKey('missing.key')).toBeNull();
  });

  it('upsert overwrites the description for an existing key instead of duplicating it', async () => {
    const repo = new InMemoryPermissionRepository(new MemoryStore());

    await repo.upsertMany([{ key: 'users.read', description: 'Old description' }]);
    await repo.upsertMany([{ key: 'users.read', description: 'New description' }]);

    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].description).toBe('New description');
  });
});
