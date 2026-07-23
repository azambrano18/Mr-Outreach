import { runMailboxRepositoryContractTests } from '../contracts/mailbox-repository.contract';
import { PrismaMailboxRepository } from './prisma-mailbox.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedOrganizations } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaMailboxRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaMailboxRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  runMailboxRepositoryContractTests(
    () => repo,
    async () => {
      // Scoped to org_1/org_2 (never a blanket deleteMany): the Fase 1
      // fixture chain owns fx_mailbox_1/fx_mailbox_org2 and the signature
      // spec owns mailbox_1/mailbox_org2 — an unscoped delete here would
      // collide with those when specs run together (--runInBand).
      await prisma.mailbox.deleteMany({ where: { organizationId: { in: ['org_1', 'org_2'] } } });
      await seedOrganizations(prisma);
      repo = new PrismaMailboxRepository(prisma);
    },
  );
});
