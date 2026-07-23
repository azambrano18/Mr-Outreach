import { runTemplateRepositoryContractTests } from '../contracts/template-repository.contract';
import { PrismaTemplateRepository } from './prisma-template.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedOrganizations } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaTemplateRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaTemplateRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  runTemplateRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.template.deleteMany();
      await seedOrganizations(prisma);
      repo = new PrismaTemplateRepository(prisma);
    },
  );
});
