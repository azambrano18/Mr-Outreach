import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive } from './fixtures';

/**
 * Spec §7 — the admin's "Todas las conversaciones" tree
 * (`GET /clients/:clientId/conversations/tree`) is scoped by clientId
 * directly, not by any executive's own assignment, and returns every
 * domain/mailbox under that client regardless of who it's assigned to.
 */
describe('Admin conversations tree (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveRoleId: string;
  const stamp = Date.now();

  async function loginAs(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return response.body.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAs(process.env.DEV_ADMIN_EMAIL as string, process.env.DEV_ADMIN_PASSWORD as string);
    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the client's domains/mailboxes regardless of executive assignment", async () => {
    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2010 });
    const clientId = client.body.id;

    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: `admin-conversations-${stamp}.test` });

    const email = `ventas.admin.conversations.${stamp}@example.com`;
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Ventas Admin Conversations E2E',
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
      });
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });
    // Deliberately never assigned to any executive.

    const tree = await request(app.getHttpServer())
      .get(`/clients/${clientId}/conversations/tree`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(tree.status).toBe(200);
    expect(tree.body).toHaveLength(1);
    expect(tree.body[0].id).toBe(clientId);
    const domainNode = tree.body[0].domains.find((d: { id: string }) => d.id === domain.body.id);
    expect(domainNode).toBeDefined();
    expect(domainNode.mailboxes.map((m: { id: string }) => m.id)).toContain(mailbox.body.id);
  });

  it('rejects an executive without conversations.read.all', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Sin Permiso Conversaciones',
      email: `admin-conversations-perm.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2011 });

    const response = await request(app.getHttpServer())
      .get(`/clients/${client.body.id}/conversations/tree`)
      .set('Authorization', `Bearer ${executive.token}`);

    expect(response.status).toBe(403);
  });

  it('returns 404 for a client that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/clients/00000000-0000-0000-0000-000000000000/conversations/tree')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
