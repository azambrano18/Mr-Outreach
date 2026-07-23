import { runCompanyRepositoryContractTests } from '../contracts/company-repository.contract';
import { PrismaCompanyRepository } from './prisma-company.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedFixtureOrganizations, seedManagedClients } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaCompanyRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaCompanyRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.company.deleteMany();
    await prisma.$disconnect();
  });

  runCompanyRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.company.deleteMany();
      await seedFixtureOrganizations(prisma);
      await seedManagedClients(prisma);
      repo = new PrismaCompanyRepository(prisma);
    },
  );
});
