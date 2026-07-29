import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive } from './fixtures';
import { MockCrmClientRepository } from '../src/infrastructure/persistence/crm/mock-crm-client.repository';
import { CRM_CLIENT_REPOSITORY } from '../src/infrastructure/persistence/tokens';

/**
 * Fase 1.5 — end-to-end coverage of CrmClientEligibilityService wired into
 * the client/domain/mailbox/assignee/sequence flows. Uses the deterministic
 * MockCrmClientRepository: a dedicated crmClientId that starts ACTIVO, then
 * gets flipped to INACTIVO via `setStatusOverride` (a test-only in-process
 * hook — never reachable from any HTTP route — mirroring the same pattern
 * SimulatedMailEngineAdapter.setImportScenario already uses elsewhere in
 * this codebase), and MOCK_CRM_OUTAGE_SENTINEL_ID to simulate a CRM outage
 * without needing real infrastructure.
 */
describe('CRM client eligibility (e2e) — memory + mock CRM driver', () => {
  let app: INestApplication;
  let mockCrmClients: MockCrmClientRepository;
  let adminToken: string;
  let executiveRoleId: string;
  const stamp = Date.now();

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  const CRM_CLIENT_ID = 2030;
  const CRM_OUTAGE_CRM_CLIENT_ID = 999999;

  function mailboxPayload(email: string) {
    return {
      name: 'Cuenta Elegibilidad E2E',
      email,
      fromName: 'Equipo E2E',
      imap: {
        host: 'imap.example.com',
        port: 993,
        encryption: 'SSL_TLS',
        username: email,
        password: 'super-secret-imap-password',
        verifyCertificate: true,
      },
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        encryption: 'STARTTLS',
        username: email,
        password: 'super-secret-smtp-password',
        verifyCertificate: true,
      },
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    mockCrmClients = app.get(CRM_CLIENT_REPOSITORY) as MockCrmClientRepository;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('activates a client using only crmClientId — name/rut/rubro come from the CRM adapter, never from the request', async () => {
    const response = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: CRM_CLIENT_ID });

    expect(response.status).toBe(201);
    expect(response.body.crmClientId).toBe(CRM_CLIENT_ID);
    // MockCrmClientRepository's generic block names these "Cliente Demo N" — never something the test itself sent.
    expect(response.body.name).toMatch(/^Cliente Demo /);
    expect(response.body.industry).toBe('Servicios');
  });

  it('rejects sending name/rut/industry manually — the DTO no longer whitelists them', async () => {
    const response = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: CRM_CLIENT_ID + 1, name: 'Nombre Manual', rut: '1-9', industry: 'Falso' });

    expect(response.status).toBe(400);
  });

  it('returns 409 activating a client the CRM reports as inactive', async () => {
    mockCrmClients.setStatusOverride(CRM_CLIENT_ID + 2, 'INACTIVO');
    try {
      const response = await request(app.getHttpServer())
        .post('/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crmClientId: CRM_CLIENT_ID + 2 });

      expect(response.status).toBe(409);
    } finally {
      mockCrmClients.clearStatusOverride(CRM_CLIENT_ID + 2);
    }
  });

  it('returns 503 when the CRM cannot be reached, and does not create anything', async () => {
    const response = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: CRM_OUTAGE_CRM_CLIENT_ID });

    expect(response.status).toBe(503);

    const list = await request(app.getHttpServer())
      .get('/clients')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      list.body.some((c: { crmClientId: number }) => c.crmClientId === CRM_OUTAGE_CRM_CLIENT_ID),
    ).toBe(false);
  });

  describe('a client that starts active, then the CRM reports it inactive', () => {
    const crmClientId = CRM_CLIENT_ID + 3;
    let clientId: string;
    let domainId: string;
    let mailboxId: string;
    let sequenceId: string;
    let executiveId: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crmClientId });
      clientId = created.body.id;

      const domain = await request(app.getHttpServer())
        .post(`/clients/${clientId}/domains`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainName: `elig-${stamp}.test` });
      domainId = domain.body.id;

      const executive = await createReadyExecutive(app, adminToken, {
        name: 'Ejecutiva Elegibilidad',
        email: `elig.${stamp}@mejoreferido.cl`,
        roleId: executiveRoleId,
      });
      executiveId = executive.id;

      await request(app.getHttpServer())
        .put(`/clients/${clientId}/assignees`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ primaryUserId: executiveId, secondaryUserIds: [] });

      const mailbox = await request(app.getHttpServer())
        .post('/mailboxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(mailboxPayload(`ventas.elig.${stamp}@example.com`));
      mailboxId = mailbox.body.id;

      await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/link-domain`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainId });
      await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/provision`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/provision/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ mode: 'ALL' });
      await request(app.getHttpServer())
        .put(`/mailboxes/${mailboxId}/assignees`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ primaryUserId: executiveId, secondaryUserIds: [] });

      const sequence = await request(app.getHttpServer())
        .post(`/users/${executiveId}/sequences/wizard`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });
      expect(sequence.status).toBe(201);
      sequenceId = sequence.body.id;

      // Now the CRM reports this client as inactive.
      mockCrmClients.setStatusOverride(crmClientId, 'INACTIVO');
    });

    afterAll(() => {
      mockCrmClients.clearStatusOverride(crmClientId);
    });

    it('rejects creating a new domain', async () => {
      const response = await request(app.getHttpServer())
        .post(`/clients/${clientId}/domains`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainName: `nuevo-${stamp}.test` });

      expect(response.status).toBe(409);
    });

    it('rejects linking a new mailbox to a domain of this client', async () => {
      const newMailbox = await request(app.getHttpServer())
        .post('/mailboxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(mailboxPayload(`ventas.elig2.${stamp}@example.com`));

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${newMailbox.body.id}/link-domain`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ domainId });

      expect(response.status).toBe(409);
    });

    it('rejects assigning a new executive to the client', async () => {
      const otherExecutive = await createReadyExecutive(app, adminToken, {
        name: 'Ejecutiva Elegibilidad Otra',
        email: `elig-otra.${stamp}@mejoreferido.cl`,
        roleId: executiveRoleId,
      });

      const response = await request(app.getHttpServer())
        .put(`/clients/${clientId}/assignees`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ primaryUserId: otherExecutive.id, secondaryUserIds: [] });

      expect(response.status).toBe(409);
    });

    it('rejects creating a new sequence for the client', async () => {
      const response = await request(app.getHttpServer())
        .post(`/users/${executiveId}/sequences/wizard`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientId, domainId, mailboxId, managementDate: '2026-08-10' });

      expect(response.status).toBe(409);
    });

    it('rejects publishing the already-created sequence', async () => {
      const response = await request(app.getHttpServer())
        .post(`/sequences/${sequenceId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `crm-elig-publish-${sequenceId}`)
        .send({});

      expect(response.status).toBe(409);
    });

    it('§10 — keeps the client, domain and sequence fully readable', async () => {
      const clientRes = await request(app.getHttpServer())
        .get(`/clients/${clientId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(clientRes.status).toBe(200);

      const domainRes = await request(app.getHttpServer())
        .get(`/domains/${domainId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(domainRes.status).toBe(200);

      const sequenceRes = await request(app.getHttpServer())
        .get(`/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(sequenceRes.status).toBe(200);
    });

    it('§11 — the CRM snapshot on the client reflects the inactive status once checked', async () => {
      const clientRes = await request(app.getHttpServer())
        .get(`/clients/${clientId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(clientRes.body.crmStatusSnapshot).toBe('INACTIVO');
      expect(clientRes.body.crmStatusCheckedAt).not.toBeNull();
      // The operational status (Mr Outreach's own) is untouched by the CRM check.
      expect(clientRes.body.status).toBe('ACTIVE');
    });
  });
});
