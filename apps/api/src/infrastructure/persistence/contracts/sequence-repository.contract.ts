import { SequenceRepository } from '../../../domain/sequence/sequence.repository';

/**
 * Regression coverage for the bug where PrismaSequenceRepository hardcoded
 * `clientId: null` on every read and silently dropped it on every write —
 * even though the application layer (SequencesService.update,
 * GenerateSimulationConversationsUseCase, DevSeedService) always tried to
 * persist it whenever the sender mailbox changed. Runs against every
 * driver via this shared contract, so a future regression of the same
 * shape (a field added to the domain entity but forgotten in one driver's
 * mapper) fails here immediately, on both memory and Postgres.
 */
export function runSequenceRepositoryContractTests(
  getRepository: () => SequenceRepository,
  reset: () => void | Promise<void>,
  fixtures: {
    orgId: string;
    otherOrgId: string;
    executiveId: string;
    clientId: string;
    otherClientId: string;
  },
): void {
  beforeEach(async () => {
    await reset();
  });

  const baseInput = () => ({
    organizationId: fixtures.orgId,
    executiveId: fixtures.executiveId,
    name: 'Contract Test Sequence',
    timezone: 'America/Santiago',
    createdBy: fixtures.executiveId,
  });

  it('creates a sequence with no clientId yet ("Pendiente de clasificación")', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());
    expect(created.clientId).toBeNull();
  });

  it('persists clientId set via update(), and returns exactly it after re-reading — never substituted by null', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());

    const updated = await repo.update(created.id, { clientId: fixtures.clientId });
    expect(updated.clientId).toBe(fixtures.clientId);

    const reread = await repo.findById(created.id);
    expect(reread!.clientId).toBe(fixtures.clientId);
  });

  it('keeps clientId untouched when a later update patches an unrelated field', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());
    await repo.update(created.id, { clientId: fixtures.clientId });

    const updated = await repo.update(created.id, { name: 'Renamed Sequence' });
    expect(updated.name).toBe('Renamed Sequence');
    expect(updated.clientId).toBe(fixtures.clientId);

    const reread = await repo.findById(created.id);
    expect(reread!.clientId).toBe(fixtures.clientId);
  });

  it('can clear clientId back to null (mailboxId unset) via an explicit update', async () => {
    const repo = getRepository();
    const created = await repo.create(baseInput());
    await repo.update(created.id, { clientId: fixtures.clientId });

    const cleared = await repo.update(created.id, { mailboxId: null, clientId: null });
    expect(cleared.clientId).toBeNull();
  });

  it('findByClient isolates by organization — two sequences with the same clientId in different orgs never leak into each other', async () => {
    const repo = getRepository();
    const ownSequence = await repo.create(baseInput());
    await repo.update(ownSequence.id, { clientId: fixtures.clientId });

    const otherOrgSequence = await repo.create({
      ...baseInput(),
      organizationId: fixtures.otherOrgId,
    });
    await repo.update(otherOrgSequence.id, { clientId: fixtures.otherClientId });

    const ownResults = await repo.findByClient(fixtures.orgId, fixtures.clientId);
    expect(ownResults.map((s) => s.id)).toContain(ownSequence.id);
    expect(ownResults.map((s) => s.id)).not.toContain(otherOrgSequence.id);

    expect(await repo.findByClient(fixtures.orgId, fixtures.otherClientId)).toHaveLength(0);
  });
}
