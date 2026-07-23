import { runIntegrationEventRepositoryContractTests } from '../contracts/integration-event-repository.contract';
import { PrismaIntegrationEventRepository } from './prisma-integration-event.repository';
import { PrismaService } from './prisma.service';
import { assertTestDatabaseEnvironment } from './test-database-guard';
import { seedFixtureOrganizations } from './test-fixtures';

/** See prisma-user.repository.contract.spec.ts for why this is skipped by default. */
const describeIfDatabaseAvailable = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDatabaseAvailable('PrismaIntegrationEventRepository (contract)', () => {
  let prisma: PrismaService;
  let repo: PrismaIntegrationEventRepository;

  beforeAll(() => {
    assertTestDatabaseEnvironment();
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.integrationEvent.deleteMany();
    await prisma.integrationCommand.deleteMany();
    await prisma.$disconnect();
  });

  runIntegrationEventRepositoryContractTests(
    () => repo,
    async () => {
      await prisma.integrationEvent.deleteMany();
      await prisma.integrationCommand.deleteMany();
      await seedFixtureOrganizations(prisma);
      // The event contract's baseInput references commandId: 'cmd_1' — the
      // FK is optional (commandId is nullable) but when present it must
      // resolve to a real command, since IntegrationEvent.commandId ->
      // IntegrationCommand.commandId is a real (if optional) foreign key.
      await prisma.integrationCommand.createMany({
        data: [
          {
            organizationId: 'fx_org_1',
            commandId: 'cmd_1',
            commandType: 'MAILBOX_PROVISION_REQUESTED',
            aggregateType: 'MAILBOX',
            aggregateId: 'fx_mailbox_1',
            schemaVersion: '1.0',
            idempotencyKey: 'fixture-command-1',
            correlationId: 'corr_fixture_1',
            payload: {},
            requestedBy: 'fx_user_1',
          },
          {
            organizationId: 'fx_org_1',
            commandId: 'cmd_2',
            commandType: 'MAILBOX_PROVISION_REQUESTED',
            aggregateType: 'MAILBOX',
            aggregateId: 'fx_mailbox_1',
            schemaVersion: '1.0',
            idempotencyKey: 'fixture-command-2',
            correlationId: 'corr_fixture_2',
            payload: {},
            requestedBy: 'fx_user_1',
          },
        ],
      });
      repo = new PrismaIntegrationEventRepository(prisma);
    },
  );
});
