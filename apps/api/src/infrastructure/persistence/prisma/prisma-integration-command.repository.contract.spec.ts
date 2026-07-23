import { runIntegrationCommandRepositoryContractTests } from '../contracts/integration-command-repository.contract';
import { PrismaIntegrationCommandRepository } from './prisma-integration-command.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedFixtureOrganizations } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaIntegrationCommandRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaIntegrationCommandRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.integrationEvent.deleteMany();
    await prisma.integrationCommand.deleteMany();
    await prisma.$disconnect();
  });

  runIntegrationCommandRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.integrationEvent.deleteMany();
      await prisma.integrationCommand.deleteMany();
      await seedFixtureOrganizations(prisma);
      repo = new PrismaIntegrationCommandRepository(prisma);
    },
  );
});
