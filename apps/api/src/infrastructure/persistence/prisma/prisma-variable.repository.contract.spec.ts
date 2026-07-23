import { runVariableRepositoryContractTests } from '../contracts/variable-repository.contract';
import { PrismaVariableRepository } from './prisma-variable.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedOrganizations } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaVariableRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaVariableRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  runVariableRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.variable.deleteMany();
      await seedOrganizations(prisma);
      repo = new PrismaVariableRepository(prisma);
    },
  );
});
