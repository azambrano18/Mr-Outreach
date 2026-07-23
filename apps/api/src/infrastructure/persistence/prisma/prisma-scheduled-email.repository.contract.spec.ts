import { runScheduledEmailRepositoryContractTests } from '../contracts/scheduled-email-repository.contract';
import { PrismaScheduledEmailRepository } from './prisma-scheduled-email.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedContacts, seedFullChain, seedSequenceContactForScheduledEmails } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaScheduledEmailRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaScheduledEmailRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.scheduledEmail.deleteMany();
    await prisma.sequenceContact.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.$disconnect();
  });

  runScheduledEmailRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.scheduledEmail.deleteMany();
      await seedFullChain(prisma);
      await seedContacts(prisma);
      await seedSequenceContactForScheduledEmails(prisma);
      repo = new PrismaScheduledEmailRepository(prisma);
    },
  );
});
