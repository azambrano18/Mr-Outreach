import { runRoleRepositoryContractTests } from '../contracts/role-repository.contract';
import { PrismaRoleRepository } from './prisma-role.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedOrganizations, seedPermissions } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaRoleRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaRoleRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  runRoleRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.rolePermission.deleteMany();
      await prisma.role.deleteMany();
      await seedOrganizations(prisma);
      await seedPermissions(prisma);
      repo = new PrismaRoleRepository(prisma);
    },
  );
});
