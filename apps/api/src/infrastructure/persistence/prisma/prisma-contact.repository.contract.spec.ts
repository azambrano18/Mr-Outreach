import { runContactRepositoryContractTests } from '../contracts/contact-repository.contract';
import { PrismaContactRepository } from './prisma-contact.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedFixtureOrganizations, seedManagedClients } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaContactRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaContactRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.contact.deleteMany();
    await prisma.$disconnect();
  });

  runContactRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.contact.deleteMany();
      await seedFixtureOrganizations(prisma);
      await seedManagedClients(prisma);
      repo = new PrismaContactRepository(prisma);
    },
  );
});
