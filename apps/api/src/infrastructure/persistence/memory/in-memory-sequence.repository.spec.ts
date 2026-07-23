import { InMemorySequenceRepository } from './in-memory-sequence.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceRepository', () => {
  it('creates a sequence in DRAFT status with no mailbox yet', async () => {
    const repo = new InMemorySequenceRepository(new MemoryStore());

    const sequence = await repo.create({
      organizationId: 'org_1',
      executiveId: 'user_1',
      name: 'Prospección',
      timezone: 'America/Santiago',
      createdBy: 'admin_1',
    });

    expect(sequence.status).toBe('DRAFT');
    expect(sequence.mailboxId).toBeNull();
  });

  it('findByExecutive scopes to both organization and executive', async () => {
    const repo = new InMemorySequenceRepository(new MemoryStore());
    await repo.create({
      organizationId: 'org_1',
      executiveId: 'user_1',
      name: 'A',
      timezone: 'America/Santiago',
      createdBy: 'admin_1',
    });
    await repo.create({
      organizationId: 'org_1',
      executiveId: 'user_2',
      name: 'B',
      timezone: 'America/Santiago',
      createdBy: 'admin_1',
    });
    await repo.create({
      organizationId: 'org_2',
      executiveId: 'user_1',
      name: 'C',
      timezone: 'America/Santiago',
      createdBy: 'admin_1',
    });

    const result = await repo.findByExecutive('org_1', 'user_1');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('A');
  });

  it('update patches only the provided fields', async () => {
    const repo = new InMemorySequenceRepository(new MemoryStore());
    const created = await repo.create({
      organizationId: 'org_1',
      executiveId: 'user_1',
      name: 'Original',
      timezone: 'America/Santiago',
      createdBy: 'admin_1',
    });

    const updated = await repo.update(created.id, { mailboxId: 'mailbox_1' });

    expect(updated.mailboxId).toBe('mailbox_1');
    expect(updated.name).toBe('Original');
  });

  it('findById returns null for a soft-deleted sequence', async () => {
    const store = new MemoryStore();
    const repo = new InMemorySequenceRepository(store);
    const created = await repo.create({
      organizationId: 'org_1',
      executiveId: 'user_1',
      name: 'X',
      timezone: 'America/Santiago',
      createdBy: 'admin_1',
    });
    store.sequences.get(created.id)!.deletedAt = new Date();

    expect(await repo.findById(created.id)).toBeNull();
  });
});
