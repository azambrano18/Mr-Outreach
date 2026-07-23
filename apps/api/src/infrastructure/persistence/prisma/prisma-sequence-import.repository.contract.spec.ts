import { runSequenceImportRepositoryContractTests } from '../contracts/sequence-import-repository.contract';
import { PrismaSequenceImportRepository } from './prisma-sequence-import.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedFullChain } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaSequenceImportRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaSequenceImportRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.sequenceImport.deleteMany();
    await prisma.$disconnect();
  });

  runSequenceImportRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.sequenceImport.deleteMany();
      await seedFullChain(prisma);
      repo = new PrismaSequenceImportRepository(prisma);
    },
  );
});
