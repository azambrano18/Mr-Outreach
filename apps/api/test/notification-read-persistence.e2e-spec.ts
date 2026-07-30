import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { linkClientMailbox } from './fixtures';

/**
 * Regression test for the "Litoral Software" bug: a mailbox still on the
 * live-sync path (MockEngineClient's canned demo threads, no
 * setScenario('CREDENTIALS_ERROR') suppression) marks a conversation read,
 * but the very next sync (any subsequent list/tree/counters call) used to
 * flip `isUnread` straight back to true — because `syncMailbox` trusts the
 * engine's own `unreadCount` as authoritative, and nothing ever told the
 * engine the thread had been read. Fixed by having `ConversationsService
 * .getById({ markAsRead: true })` also call `MailboxesService
 * .setThreadReadState` so the engine's own view stays in sync.
 */
describe('Notification read-state persists across re-syncs (e2e) — memory + mock engine, live-sync mailbox', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminUserId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const stamp = Date.now();

  async function loginAs(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return response.body.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAs(adminEmail, adminPassword);
    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    adminUserId = me.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps a conversation read after opening it, even across further syncs', async () => {
    const { clientId } = await linkClientMailbox(app, adminToken, adminUserId);
    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: `notif-persistence-${stamp}.cl` });
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Ventas Persistence E2E',
        email: `ventas.persistence.${stamp}@example.com`,
        fromName: 'Equipo de Ventas',
        imap: {
          host: 'imap.example.com',
          port: 993,
          encryption: 'SSL_TLS',
          username: `ventas.persistence.${stamp}@example.com`,
          password: 'super-secret-imap-password',
          verifyCertificate: true,
        },
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          encryption: 'STARTTLS',
          username: `ventas.persistence.${stamp}@example.com`,
          password: 'super-secret-smtp-password',
          verifyCertificate: true,
        },
      });
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });

    // First sync — the mock engine's canned demo threads include some unread ones.
    const firstList = await request(app.getHttpServer())
      .get(`/conversations?clientId=${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(firstList.status).toBe(200);
    const unread = firstList.body.find((c: { isUnread: boolean }) => c.isUnread === true);
    expect(unread).toBeDefined();

    // Opening it marks it read.
    const opened = await request(app.getHttpServer())
      .get(`/conversations/${unread.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(opened.status).toBe(200);
    expect(opened.body.isUnread).toBe(false);

    // A second (and third) sync must NOT resurrect the unread flag.
    for (let i = 0; i < 2; i += 1) {
      const relisted = await request(app.getHttpServer())
        .get(`/conversations?clientId=${clientId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const same = relisted.body.find((c: { id: string }) => c.id === unread.id);
      expect(same).toBeDefined();
      expect(same.isUnread).toBe(false);
    }

    // Counters must reflect the real, currently-unread conversations — never a stale/static value.
    const counters = await request(app.getHttpServer())
      .get(`/conversations/counters?clientId=${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(counters.status).toBe(200);
    const stillUnreadList = await request(app.getHttpServer())
      .get(`/conversations?clientId=${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const actualUnreadCount = stillUnreadList.body.filter((c: { isUnread: boolean }) => c.isUnread).length;
    expect(actualUnreadCount).toBeLessThan(firstList.body.filter((c: { isUnread: boolean }) => c.isUnread).length);
  });
});
