import { InMemorySequenceTemplateRepository } from './in-memory-sequence-template.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceTemplateRepository', () => {
  let store: MemoryStore;
  let repo: InMemorySequenceTemplateRepository;

  beforeEach(() => {
    store = new MemoryStore();
    repo = new InMemorySequenceTemplateRepository(store);
  });

  it('update() does not wipe fields the caller omitted (undefined key means "leave unchanged")', async () => {
    const template = await repo.create({
      organizationId: 'org-1',
      ownerUserId: 'user-1',
      mailboxId: 'mailbox-1',
      name: 'Prospección Gerentes de RRHH',
      description: 'Descripción original',
      timezone: 'America/Santiago',
    });

    // Mirrors a subject-only PATCH: `name`/`description` are present as keys but `undefined`.
    const updated = await repo.update(template.id, {
      name: undefined,
      description: undefined,
      subjectTemplate: 'Nuevo asunto',
    });

    expect(updated.name).toBe('Prospección Gerentes de RRHH');
    expect(updated.description).toBe('Descripción original');
    expect(updated.subjectTemplate).toBe('Nuevo asunto');
  });

  it('update() still applies an explicit null (distinct from undefined)', async () => {
    const template = await repo.create({
      organizationId: 'org-1',
      ownerUserId: 'user-1',
      mailboxId: 'mailbox-1',
      name: 'Prospección Gerentes de RRHH',
      timezone: 'America/Santiago',
    });
    await repo.update(template.id, { status: 'ARCHIVED', archivedAt: new Date() });

    const reopened = await repo.update(template.id, { status: 'DRAFT', archivedAt: null });
    expect(reopened.archivedAt).toBeNull();
    expect(reopened.name).toBe('Prospección Gerentes de RRHH');
  });
});
