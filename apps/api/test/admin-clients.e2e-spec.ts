import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { linkClientMailbox } from './fixtures';

describe('Admin clients local overview (e2e) — memory + simulated motor', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminUserId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    adminUserId = me.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists a client created via mailbox-link redemption as CONFIGURADO (domain+mailbox+assignee already present)', async () => {
    const { clientId } = await linkClientMailbox(app, adminToken, adminUserId, { clientName: 'Cliente Overview E2E' });

    const response = await request(app.getHttpServer())
      .get('/clients/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(true);
    const found = response.body.clients.find((c: { id: string }) => c.id === clientId);
    expect(found).toBeDefined();
    expect(found.configurationStatus).toBe('CONFIGURADO');
    expect(found.domainCount).toBe(1);
    expect(found.mailboxCount).toBe(1);
    expect(found.assignedExecutiveCount).toBe(1);
  });

  it('reports CONFIGURACION_INCOMPLETA once the client loses its only assignee', async () => {
    const { clientId } = await linkClientMailbox(app, adminToken, adminUserId, { clientName: 'Cliente Incompleto E2E' });

    await request(app.getHttpServer())
      .put(`/clients/${clientId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: null, secondaryUserIds: [] });

    const response = await request(app.getHttpServer())
      .get('/clients/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    const found = response.body.clients.find((c: { id: string }) => c.id === clientId);
    expect(found.configurationStatus).toBe('CONFIGURACION_INCOMPLETA');
  });

  it('filters by search term against the client name', async () => {
    const stamp = Date.now();
    await linkClientMailbox(app, adminToken, adminUserId, { clientName: `Buscable ${stamp}` });

    const response = await request(app.getHttpServer())
      .get(`/clients/overview?search=Buscable ${stamp}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.clients.length).toBeGreaterThan(0);
    expect(response.body.clients.every((c: { name: string }) => c.name.includes(`Buscable ${stamp}`))).toBe(true);
  });

  it('never exposes any CRM-specific field on the overview rows', async () => {
    await linkClientMailbox(app, adminToken, adminUserId, { clientName: 'Cliente Sin CRM E2E' });

    const response = await request(app.getHttpServer())
      .get('/clients/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(JSON.stringify(response.body)).not.toMatch(/crmClientId|crmStatus|rubro/i);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app.getHttpServer()).get('/clients/overview');
    expect(response.status).toBe(401);
  });
});
