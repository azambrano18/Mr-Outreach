import { runSignatureRepositoryContractTests } from '../contracts/signature-repository.contract';
import { PrismaSignatureRepository } from './prisma-signature.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedLegacyMailboxForSignature, seedOrganizations } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaSignatureRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaSignatureRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    // Leaves no trace: mailbox_1/mailbox_org2 are shared with the mailbox
    // spec's organization ids (org_1/org_2), which asserts an *exact*
    // mailbox count per organization — this row must not outlive this file.
    await prisma.signature.deleteMany();
    await prisma.mailbox.deleteMany({ where: { id: { in: ['mailbox_1', 'mailbox_org2'] } } });
    await prisma.$disconnect();
  });

  runSignatureRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.signature.deleteMany();
      await seedOrganizations(prisma);
      await seedLegacyMailboxForSignature(prisma);
      repo = new PrismaSignatureRepository(prisma);
    },
  );
});
