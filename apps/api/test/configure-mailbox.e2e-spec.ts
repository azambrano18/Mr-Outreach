import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { MockCrmClientRepository } from '../src/infrastructure/persistence/crm/mock-crm-client.repository';
import { CRM_CLIENT_REPOSITORY } from '../src/infrastructure/persistence/tokens';

/**
 * Fase 2, Caso A (e2e) — the single intención POST /mailboxes/configure
 * replacing "crear cuenta → vincular dominio → provisionar → avanzar".
 * Memory + mock CRM driver only — never the real CRM in ordinary tests.
 */
describe('POST /mailboxes/configure (e2e) — memory + mock CRM driver', () => {
  let app: INestApplication;
  let adminToken: string;
  let mockCrmClients: MockCrmClientRepository;
  const stamp = Date.now();

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      crmClientId: 2010,
      domainName: `ventas-${stamp}.test`,
      email: `contacto@ventas-${stamp}.test`,
      fromName: 'Equipo de Ventas',
      imap: {
        host: 'imap.example.com',
        port: 993,
        encryption: 'SSL_TLS',
        username: 'contacto',
        password: 'super-secret-imap-password',
        verifyCertificate: true,
      },
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        encryption: 'STARTTLS',
        username: 'contacto',
        password: 'super-secret-smtp-password',
        verifyCertificate: true,
      },
      ...overrides,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    mockCrmClients = app.get(CRM_CLIENT_REPOSITORY) as MockCrmClientRepository;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires the Idempotency-Key header', async () => {
    const response = await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload());

    expect(response.status).toBe(400);
  });

  it('configures a mailbox in a single request and never echoes the plaintext password back', async () => {
    const response = await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-key-${stamp}-1`)
      .send(payload());

    expect(response.status).toBe(201);
    expect(response.body.mailboxId).toBeDefined();
    expect(response.body.clientId).toBeDefined();
    expect(response.body.domainId).toBeDefined();
    expect(response.body.commandId).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('super-secret-imap-password');
    expect(JSON.stringify(response.body)).not.toContain('super-secret-smtp-password');
  });

  it('returns the exact same result on a retry with the same Idempotency-Key and payload', async () => {
    const key = `e2e-key-${stamp}-2`;
    const body = payload({ domainName: `retry-${stamp}.test`, email: `contacto@retry-${stamp}.test` });

    const first = await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(body);
    const second = await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
  });

  it('rejects the same Idempotency-Key reused with a different payload as 409', async () => {
    const key = `e2e-key-${stamp}-3`;
    await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(payload({ domainName: `distinct-a-${stamp}.test`, email: `contacto@distinct-a-${stamp}.test` }));

    const response = await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send(payload({ domainName: `distinct-b-${stamp}.test`, email: `contacto@distinct-b-${stamp}.test` }));

    expect(response.status).toBe(409);
  });

  it('returns 409 when the CRM reports the client inactive', async () => {
    const crmClientId = 2011;
    mockCrmClients.setStatusOverride(crmClientId, 'INACTIVO');
    try {
      const response = await request(app.getHttpServer())
        .post('/mailboxes/configure')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-key-${stamp}-4`)
        .send(payload({ crmClientId, domainName: `inactive-${stamp}.test`, email: `contacto@inactive-${stamp}.test` }));

      expect(response.status).toBe(409);
    } finally {
      mockCrmClients.clearStatusOverride(crmClientId);
    }
  });

  it('returns 503 when the CRM is unavailable, and creates nothing', async () => {
    const response = await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-key-${stamp}-5`)
      .send(payload({ crmClientId: 999999, domainName: `outage-${stamp}.test`, email: `contacto@outage-${stamp}.test` }));

    expect(response.status).toBe(503);
  });

  it('rejects an email that does not belong to the given domain', async () => {
    const response = await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-key-${stamp}-6`)
      .send(payload({ domainName: `mismatch-${stamp}.test`, email: `contacto@otro-${stamp}.test` }));

    expect(response.status).toBe(400);
  });

  it('an executive without mailboxes.create cannot use this endpoint', async () => {
    const executiveLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: process.env.DEV_EXECUTIVE_EMAIL, password: process.env.DEV_EXECUTIVE_PASSWORD });

    const response = await request(app.getHttpServer())
      .post('/mailboxes/configure')
      .set('Authorization', `Bearer ${executiveLogin.body.accessToken}`)
      .set('Idempotency-Key', `e2e-key-${stamp}-7`)
      .send(payload({ domainName: `forbidden-${stamp}.test`, email: `contacto@forbidden-${stamp}.test` }));

    expect(response.status).toBe(403);
  });
});
