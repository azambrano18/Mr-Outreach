import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../../app.module';
import { CRM_CLIENT_REPOSITORY } from '../tokens';
import { CrmClientRepository } from '../../../domain/crm-client/crm-client.repository';

/**
 * Fase 1.5 (cierre operativo) — the one deliberate, separately-run suite
 * that actually talks to the real, external CRM database (maestro_clientes)
 * through the app's real wiring (AppModule → CRM_CLIENT_REPOSITORY →
 * PostgresCrmClientRepository). Never runs as part of `npm test` or
 * `npm run test:e2e` — it auto-skips unless ALLOW_REAL_CRM_IN_TESTS=true,
 * mirroring the same `describe.skip` convention the Postgres contract
 * specs already use for TEST_DATABASE_URL. Run it explicitly via:
 *
 *   npm run test:crm-integration
 *
 * That script sets CRM_DRIVER=postgres + ALLOW_REAL_CRM_IN_TESTS=true; the
 * real CRM_DATABASE_URL itself still comes only from the local, gitignored
 * apps/api/.env — never hardcoded here. This file never logs or asserts
 * on the connection string, nor on any real client's name or RUT — only
 * structural facts (status normalization, absence of mock ids).
 */
const describeIfCrmIntegrationAllowed = process.env.ALLOW_REAL_CRM_IN_TESTS === 'true' ? describe : describe.skip;

const MOCK_CRM_CLIENT_IDS = new Set<number>([
  1001,
  1002,
  1003,
  1004,
  1005,
  ...Array.from({ length: 50 }, (_, index) => 2001 + index),
]);

describeIfCrmIntegrationAllowed('Real CRM integration (deliberate, opt-in only)', () => {
  let repository: CrmClientRepository;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    if (process.env.CRM_DRIVER !== 'postgres') {
      throw new Error('This suite requires CRM_DRIVER=postgres — run it via `npm run test:crm-integration`.');
    }
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    repository = moduleRef.get(CRM_CLIENT_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('returns only normalized-ACTIVE clients from the real catalog, never the mock demo dataset', async () => {
    const clients = await repository.findAllActive();
    expect(Array.isArray(clients)).toBe(true);

    for (const client of clients) {
      expect(client.status.trim().toUpperCase()).toBe('ACTIVO');
      expect(MOCK_CRM_CLIENT_IDS.has(client.crmClientId)).toBe(false);
    }
  });

  it('findById returns null for a crmClientId that does not exist, without throwing', async () => {
    const result = await repository.findById(-1);
    expect(result).toBeNull();
  });
});
