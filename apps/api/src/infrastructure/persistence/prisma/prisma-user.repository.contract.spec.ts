import { runUserRepositoryContractTests } from '../contracts/user-repository.contract';
import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedOrganizations } from './test-fixtures';

/**
 * Proves PrismaUserRepository satisfies the exact same contract as
 * InMemoryUserRepository — see in-memory-user.repository.spec.ts. Skipped
 * by default unless TEST_DATABASE_URL points at a disposable PostgreSQL
 * database (Fase 1 — see README's "Persistencia PostgreSQL" section).
 */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaUserRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaUserRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  runUserRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.userRole.deleteMany();
      // Scoped to org_1/org_2 (never a blanket deleteMany): the newer Fase 1
      // fixture chain (test-fixtures.ts) creates its own fx_user_1/
      // fx_user_org2, referenced by fx_sequence_1's executiveId FK — an
      // unscoped delete here would collide with those when run together.
      await prisma.user.deleteMany({ where: { organizationId: { in: ['org_1', 'org_2'] } } });
      await seedOrganizations(prisma);
      repo = new PrismaUserRepository(prisma);
    },
  );
});
