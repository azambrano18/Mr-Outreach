import { runManagedClientRepositoryContractTests } from '../contracts/managed-client-repository.contract';
import { PrismaManagedClientRepository } from './prisma-managed-client.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedFixtureOrganizations } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaManagedClientRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaManagedClientRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    // Scoped delete: fx_client_1/fx_client_2/fx_client_org2 are shared
    // fixtures other Fase 1 contract specs depend on (Company/Contact/
    // SequenceImport family) — only this file's own crmClientId range
    // (501/502) is ours to clean up.
    await prisma.managedClient.deleteMany({ where: { crmClientId: { in: [501, 502] } } });
    await prisma.$disconnect();
  });

  runManagedClientRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.managedClient.deleteMany({ where: { crmClientId: { in: [501, 502] } } });
      await seedFixtureOrganizations(prisma);
      repo = new PrismaManagedClientRepository(prisma);
    },
  );
});
