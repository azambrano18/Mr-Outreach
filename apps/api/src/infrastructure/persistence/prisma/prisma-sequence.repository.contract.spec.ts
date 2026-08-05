import { runSequenceRepositoryContractTests } from '../contracts/sequence-repository.contract';
import { PrismaSequenceRepository } from './prisma-sequence.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedSequenceClientIdFixtures } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaSequenceRepository (contract) — Sequence.clientId persistence', () => {
  let prisma: PrismaService;
  let repo: PrismaSequenceRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.sequence.deleteMany({ where: { organizationId: { in: ['sq_org_1', 'sq_org_2'] } } });
    await prisma.$disconnect();
  });

  runSequenceRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.sequence.deleteMany({ where: { organizationId: { in: ['sq_org_1', 'sq_org_2'] } } });
      await seedSequenceClientIdFixtures(prisma);
      repo = new PrismaSequenceRepository(prisma);
    },
    {
      orgId: 'sq_org_1',
      otherOrgId: 'sq_org_2',
      executiveId: 'sq_user_1',
      clientId: 'sq_client_1',
      otherClientId: 'sq_client_2',
    },
  );
});
