import { PrismaSequenceRepository } from './prisma-sequence.repository';
import { PrismaService } from './prisma.service';

/**
 * Regression guard for the bug fixed by the sequence-client-id migration:
 * PrismaSequenceRepository used to hardcode `clientId: null` on every read
 * and silently drop it from the `update()` write, even though callers
 * (SequencesService.update, GenerateSimulationConversationsUseCase) always
 * tried to persist it. This spec mocks the Prisma Client directly — no live
 * database needed — and asserts the exact `data`/mapped-row shape, so a
 * future reintroduction of that hardcoding (or an accidental omission on a
 * new field) fails here even when TEST_DATABASE_URL isn't configured (see
 * prisma-sequence.repository.contract.spec.ts for the live-Postgres
 * equivalent, gated behind that env var).
 */
describe('PrismaSequenceRepository — clientId mapping (mocked Prisma Client)', () => {
  function buildRepo() {
    const prismaMock = {
      sequence: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const repo = new PrismaSequenceRepository(prismaMock as unknown as PrismaService);
    return { repo, prismaMock };
  }

  const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'sequence_1',
    organizationId: 'org_1',
    executiveId: 'exec_1',
    mailboxId: 'mailbox_1',
    clientId: 'client_1',
    name: 'Sequence',
    description: null,
    status: 'DRAFT',
    timezone: 'America/Santiago',
    publishStatus: null,
    effectiveStartAt: null,
    sequenceVersion: 0,
    lastPublishedAt: null,
    lastPublishCommandId: null,
    createdBy: 'exec_1',
    updatedBy: 'exec_1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

  it('update() forwards clientId to the Prisma Client\'s data payload — never drops or hardcodes it to null', async () => {
    const { repo, prismaMock } = buildRepo();
    prismaMock.sequence.update.mockResolvedValue(row({ clientId: 'client_1' }));

    await repo.update('sequence_1', { mailboxId: 'mailbox_1', clientId: 'client_1' });

    expect(prismaMock.sequence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sequence_1' },
        data: expect.objectContaining({ clientId: 'client_1' }),
      }),
    );
    // The literal regression this guards: `data.clientId` must never be a
    // hardcoded `null` regardless of what the caller passed.
    const dataArg = prismaMock.sequence.update.mock.calls[0][0].data;
    expect(dataArg.clientId).not.toBeNull();
    expect(dataArg.clientId).toBe('client_1');
  });

  it('update() can still explicitly clear clientId to null when the caller asks for that', async () => {
    const { repo, prismaMock } = buildRepo();
    prismaMock.sequence.update.mockResolvedValue(row({ clientId: null, mailboxId: null }));

    await repo.update('sequence_1', { mailboxId: null, clientId: null });

    const dataArg = prismaMock.sequence.update.mock.calls[0][0].data;
    expect(dataArg.clientId).toBeNull();
  });

  it('toDomain() reads clientId straight from the row — never overrides it to null', async () => {
    const { repo, prismaMock } = buildRepo();
    prismaMock.sequence.findFirst.mockResolvedValue(row({ clientId: 'client_1' }));

    const found = await repo.findById('sequence_1');

    expect(found!.clientId).toBe('client_1');
  });

  it('findByClient() queries Prisma by organizationId + clientId — no longer the old always-empty-array stub', async () => {
    const { repo, prismaMock } = buildRepo();
    prismaMock.sequence.findMany.mockResolvedValue([row({ clientId: 'client_1' })]);

    const results = await repo.findByClient('org_1', 'client_1');

    expect(prismaMock.sequence.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', clientId: 'client_1', deletedAt: null },
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.clientId).toBe('client_1');
  });
});
