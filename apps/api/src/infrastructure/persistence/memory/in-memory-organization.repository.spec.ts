import { InMemoryOrganizationRepository } from './in-memory-organization.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryOrganizationRepository', () => {
  it('creates an organization and finds it by id', async () => {
    const repo = new InMemoryOrganizationRepository(new MemoryStore());

    const created = await repo.create({ name: 'MejoReferido' });
    const found = await repo.findById(created.id);

    expect(found?.name).toBe('MejoReferido');
  });

  it('returns null for an id that does not exist', async () => {
    const repo = new InMemoryOrganizationRepository(new MemoryStore());

    expect(await repo.findById('missing')).toBeNull();
  });
});
