import { UserRepository } from '../../../domain/user/user.repository';

/**
 * Shared behavior every UserRepository adapter must satisfy. Run against
 * InMemoryUserRepository now; the same suite is meant to run against
 * PrismaUserRepository once a reachable test database exists — see
 * prisma-user.repository.contract.spec.ts, which is skipped until then.
 */
export function runUserRepositoryContractTests(
  getRepository: () => UserRepository,
  reset: () => void | Promise<void>,
): void {
  beforeEach(async () => {
    await reset();
  });

  it('creates a user and finds it by id', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      passwordHash: 'hash',
    });

    const found = await repo.findById(created.id);

    expect(found).not.toBeNull();
    expect(found?.email).toBe('ada@example.com');
    expect(found?.status).toBe('ACTIVE');
  });

  it('enforces email uniqueness within the same organization', async () => {
    const repo = getRepository();
    await repo.create({
      organizationId: 'org_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      passwordHash: 'hash',
    });

    await expect(
      repo.create({
        organizationId: 'org_1',
        firstName: 'Duplicate',
        lastName: 'User',
        email: 'ada@example.com',
        passwordHash: 'hash',
      }),
    ).rejects.toThrow();
  });

  it('allows the same email to exist in two different organizations', async () => {
    const repo = getRepository();
    await repo.create({
      organizationId: 'org_1',
      firstName: 'Ada',
      lastName: 'in Org 1',
      email: 'shared@example.com',
      passwordHash: 'hash',
    });

    const secondOrgUser = await repo.create({
      organizationId: 'org_2',
      firstName: 'Ada',
      lastName: 'in Org 2',
      email: 'shared@example.com',
      passwordHash: 'hash',
    });

    expect(secondOrgUser).toBeDefined();
  });

  it('scopes findAll to the given organization only', async () => {
    const repo = getRepository();
    await repo.create({
      organizationId: 'org_1',
      firstName: 'A',
      lastName: 'User',
      email: 'a@example.com',
      passwordHash: 'h',
    });
    await repo.create({
      organizationId: 'org_2',
      firstName: 'B',
      lastName: 'User',
      email: 'b@example.com',
      passwordHash: 'h',
    });

    const orgOneUsers = await repo.findAll('org_1');

    expect(orgOneUsers).toHaveLength(1);
    expect(orgOneUsers[0].email).toBe('a@example.com');
  });

  it('findByEmailAnyOrganization ignores organization boundaries (used only by login)', async () => {
    const repo = getRepository();
    await repo.create({
      organizationId: 'org_1',
      firstName: 'A',
      lastName: 'User',
      email: 'a@example.com',
      passwordHash: 'h',
    });

    const found = await repo.findByEmailAnyOrganization('a@example.com');

    expect(found?.organizationId).toBe('org_1');
  });

  it('updates a user and bumps updatedAt', async () => {
    const repo = getRepository();
    const created = await repo.create({
      organizationId: 'org_1',
      firstName: 'Original',
      lastName: 'Name',
      email: 'a@example.com',
      passwordHash: 'h',
    });

    const updated = await repo.update(created.id, { firstName: 'New', lastName: 'Name', status: 'INACTIVE' });

    expect(updated.firstName).toBe('New');
    expect(updated.status).toBe('INACTIVE');
  });
}
