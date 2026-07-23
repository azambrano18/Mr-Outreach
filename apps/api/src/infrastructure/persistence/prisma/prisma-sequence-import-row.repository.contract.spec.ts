import { runSequenceImportRowRepositoryContractTests } from '../contracts/sequence-import-row-repository.contract';
import { PrismaSequenceImportRowRepository } from './prisma-sequence-import-row.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedContacts, seedFullChain, seedSequenceImportForRows } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaSequenceImportRowRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaSequenceImportRowRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.sequenceImportRow.deleteMany();
    await prisma.sequenceImport.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.$disconnect();
  });

  runSequenceImportRowRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.sequenceImportRow.deleteMany();
      await seedFullChain(prisma);
      await seedContacts(prisma);
      await seedSequenceImportForRows(prisma);
      repo = new PrismaSequenceImportRowRepository(prisma);
    },
  );
});
