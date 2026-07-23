import { runSequenceContactRepositoryContractTests } from '../contracts/sequence-contact-repository.contract';
import { PrismaSequenceContactRepository } from './prisma-sequence-contact.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedContacts, seedFullChain, seedSequenceImportForRows } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaSequenceContactRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaSequenceContactRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.sequenceContact.deleteMany();
    await prisma.sequenceImport.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.$disconnect();
  });

  runSequenceContactRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.sequenceContact.deleteMany();
      await seedFullChain(prisma);
      await seedContacts(prisma);
      await seedSequenceImportForRows(prisma);
      repo = new PrismaSequenceContactRepository(prisma);
    },
  );
});
