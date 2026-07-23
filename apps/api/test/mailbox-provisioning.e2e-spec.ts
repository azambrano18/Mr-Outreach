import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Mailbox provisioning simulation (e2e) — memory + simulated engine', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminUserId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  async function createMailbox(email: string) {
    const response = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Ventas Provisioning E2E',
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
    return response.body.id as string;
  }

  let nextCrmClientId = 2010;

  async function createClientAndDomain() {
    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: nextCrmClientId++ });
    const domain = await request(app.getHttpServer())
      .post(`/clients/${client.body.id}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: `provisioning-e2e-${Date.now()}.test` });
    return { clientId: client.body.id as string, domainId: domain.body.id as string };
  }

  beforeAll(async () => {
    app = await createTestApp();
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
    adminUserId = adminLogin.body.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a provisioning request for a mailbox not yet linked to a client/domain', async () => {
    const mailboxId = await createMailbox(`unlinked-${Date.now()}@example.com`);
    const response = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(response.status).toBe(409);
  });

  it('generates MAILBOX_PROVISION_REQUESTED with secrets redacted, detects duplicate submissions, and completes on SUCCESS', async () => {
    const { clientId, domainId } = await createClientAndDomain();
    const mailboxId = await createMailbox(`provision-success-${Date.now()}@example.com`);
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId });

    const idempotencyKey = `test-idem-${Date.now()}`;
    const first = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ idempotencyKey });

    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.command.commandType).toBe('MAILBOX_PROVISION_REQUESTED');
    expect(first.body.command.payload.mailbox.imap.credentialReference).toMatch(/^secret_ref_demo_/);
    expect(JSON.stringify(first.body.command.payload)).not.toContain('super-secret-imap-password');
    expect(JSON.stringify(first.body.command.payload)).not.toContain('super-secret-smtp-password');
    expect(first.body.command.payload.clientId).toBe(clientId);

    // §43 — resubmitting the SAME idempotencyKey must reuse the previous command, not create a second one.
    const duplicate = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ idempotencyKey });
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.command.commandId).toBe(first.body.command.commandId);

    const afterAll = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision/advance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'ALL' });

    expect(afterAll.status).toBe(201);
    expect(afterAll.body.mailbox.provisioningStatus).toBe('PROVISIONED');
    expect(afterAll.body.mailbox.connectionStatus).toBe('CONNECTED');
    expect(afterAll.body.mailbox.operationalStatus).toBe('READY');
    expect(afterAll.body.events.some((e: { eventType: string }) => e.eventType === 'MAILBOX_PROVISION_COMPLETED')).toBe(
      true,
    );

    // Spec §8 — the engine's own reported state changes must be audited, without secrets.
    const auditLog = await request(app.getHttpServer())
      .get(`/users/${adminUserId}/audit-log`)
      .set('Authorization', `Bearer ${adminToken}`);
    const actions = auditLog.body.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('mailbox.provision_started');
    expect(actions).toContain('mailbox.provision_completed');
    expect(JSON.stringify(auditLog.body)).not.toContain('super-secret-imap-password');
    expect(JSON.stringify(auditLog.body)).not.toContain('super-secret-smtp-password');

    // Advancing again once every planned event has landed must be a safe no-op.
    const noop = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision/advance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'ALL' });
    expect(noop.body.events).toHaveLength(0);
  });

  it('an IMAP_ERROR scenario leaves the mailbox PROVISION_FAILED / ERROR instead of READY', async () => {
    const { domainId } = await createClientAndDomain();
    const mailboxId = await createMailbox(`provision-imap-error-${Date.now()}@example.com`);
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId });

    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision/scenario`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scenario: 'IMAP_ERROR' });

    const result = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision/advance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'ALL' });

    expect(result.body.mailbox.provisioningStatus).toBe('PROVISION_FAILED');
    expect(result.body.mailbox.operationalStatus).toBe('ERROR');
  });
});
