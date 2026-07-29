import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('CRM clients (e2e) — memory + mock CRM driver', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const executiveLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: executiveEmail, password: executivePassword });
    executiveToken = executiveLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('an executive without crm_clients.read is forbidden', async () => {
    const response = await request(app.getHttpServer())
      .get('/crm-clients')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(response.status).toBe(403);
  });

  it('lists only active CRM clients (never inactive ones), each with the real column shape', async () => {
    const response = await request(app.getHttpServer())
      .get('/crm-clients')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
    for (const client of response.body) {
      expect(client.status.trim().toUpperCase()).toBe('ACTIVO');
      expect(typeof client.crmClientId).toBe('number');
      expect(typeof client.name).toBe('string');
    }
    // The demo dataset includes inactive rows (one with a trailing-space status) — must never appear.
    expect(response.body.map((c: { name: string }) => c.name)).not.toContain('Demo Retail Centro');
    expect(response.body.map((c: { name: string }) => c.name)).not.toContain('Demo Alimentos Costa');
  });

  it('filters by search (case-insensitive substring on name)', async () => {
    const response = await request(app.getHttpServer())
      .get('/crm-clients?search=tecnología sur')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.map((c: { name: string }) => c.name)).toEqual(['Demo Tecnología Sur']);
  });

  it('gets a single CRM client by id', async () => {
    const list = await request(app.getHttpServer())
      .get('/crm-clients')
      .set('Authorization', `Bearer ${adminToken}`);
    const first = list.body[0];

    const response = await request(app.getHttpServer())
      .get(`/crm-clients/${first.crmClientId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.crmClientId).toBe(first.crmClientId);
  });

  it('returns 404 for a CRM client id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/crm-clients/9999999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
