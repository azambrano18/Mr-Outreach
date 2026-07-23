import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Admin clients CRM overview (e2e) — memory + mock CRM driver', () => {
  let app: INestApplication;
  let adminToken: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  function mailboxPayload(email: string) {
    return {
      name: 'Ventas Admin Clients E2E',
      email,
      fromName: 'Equipo de Ventas',
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

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects creating a ManagedClient for a crmClientId that does not exist in the CRM', async () => {
    const response = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 9999999 });

    expect(response.status).toBe(404);
  });

  it('Fase 1.5 — activating the same crmClientId twice is idempotent (upsert), not a rejection', async () => {
    const first = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2020 });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2020 });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it('crm-overview lists a CRM client with SIN_CONFIGURAR when never configured locally', async () => {
    const response = await request(app.getHttpServer())
      .get('/clients/crm-overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(true);
    const neverConfigured = response.body.clients.find((c: { crmClientId: number }) => c.crmClientId === 2021);
    expect(neverConfigured).toBeDefined();
    expect(neverConfigured.configurationStatus).toBe('SIN_CONFIGURAR');
    expect(neverConfigured.managedClientId).toBeNull();
  });

  it('crm-overview reports CONFIGURACION_INCOMPLETA right after configuring, then CONFIGURADO once domain+mailbox+executive exist', async () => {
    const created = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2022 });
    expect(created.status).toBe(201);

    const afterCreate = await request(app.getHttpServer())
      .get('/clients/crm-overview/2022')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterCreate.body.configurationStatus).toBe('CONFIGURACION_INCOMPLETA');
    expect(afterCreate.body.managedClientId).toBe(created.body.id);

    const domain = await request(app.getHttpServer())
      .post(`/clients/${created.body.id}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: 'progresivo-e2e.cl' });
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload('ventas@progresivo-e2e.cl'));
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });

    const stillIncomplete = await request(app.getHttpServer())
      .get('/clients/crm-overview/2022')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(stillIncomplete.body.configurationStatus).toBe('CONFIGURACION_INCOMPLETA'); // no assigned executive yet

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    const executiveRoleId = roles.body.find((r: { name: string }) => r.name === 'EXECUTIVE').id;
    const executive = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Ejecutivo', lastName: 'Progresivo', email: 'ejecutivo.progresivo@mejoreferido.cl', roleId: executiveRoleId });
    await request(app.getHttpServer())
      .put(`/clients/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executive.body.id, secondaryUserIds: [] });

    const configured = await request(app.getHttpServer())
      .get('/clients/crm-overview/2022')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(configured.body.configurationStatus).toBe('CONFIGURADO');
    expect(configured.body.domainCount).toBe(1);
    expect(configured.body.mailboxCount).toBe(1);
    expect(configured.body.assignedExecutiveCount).toBe(1);
  });

  it('returns 404 for a crmClientId that does not exist in the CRM at all', async () => {
    const response = await request(app.getHttpServer())
      .get('/clients/crm-overview/9999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });

  it('exposes a client-scoped audit log entry for its creation', async () => {
    const created = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2023 });

    const auditLog = await request(app.getHttpServer())
      .get(`/clients/${created.body.id}/audit-log`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(auditLog.status).toBe(200);
    expect(auditLog.body.some((entry: { action: string }) => entry.action === 'client.activate')).toBe(true);
  });
});
