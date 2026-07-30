import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive, linkClientMailbox } from './fixtures';

describe('Client hierarchy + Centro de conversaciones (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminUserId: string;
  let executiveRoleId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  async function createExecutive(email: string) {
    const { id, token } = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutivo E2E',
      email,
      roleId: executiveRoleId,
    });
    return { id, token };
  }

  async function loginAs(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return response.body.accessToken as string;
  }

  function mailboxPayload(email: string) {
    return {
      name: 'Ventas E2E',
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
    adminToken = await loginAs(adminEmail, adminPassword);

    const rolesResponse = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = rolesResponse.body.find(
      (role: { name: string }) => role.name === 'EXECUTIVE',
    ).id;
    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    adminUserId = me.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a client (via mailbox-link redemption), a second domain under it, and rejects a duplicate domain name in the same org', async () => {
    const { clientId } = await linkClientMailbox(app, adminToken, adminUserId);
    const client = await request(app.getHttpServer())
      .get(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(client.body.status).toBe('ACTIVE');
    expect(client.body.domainCount).toBe(1); // the fixture's own domain, from the link redemption

    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: 'vertex-e2e.cl' });
    expect(domain.status).toBe(201);
    expect(domain.body.clientId).toBe(clientId);

    const duplicate = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: 'vertex-e2e.cl' });
    expect(duplicate.status).toBe(409);

    const refreshedClient = await request(app.getHttpServer())
      .get(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(refreshedClient.body.domainCount).toBe(2);
  });

  it('returns 404 (not 403) for a client id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/clients/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });

  it('links a mailbox to a domain, and the client/domain mailbox counts and lists reflect it', async () => {
    const { clientId } = await linkClientMailbox(app, adminToken, adminUserId);
    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: 'gtd-e2e.cl' });
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload('ventas@gtd-e2e.cl'));

    const linked = await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });
    expect(linked.status).toBe(201);
    expect(linked.body.clientId).toBe(clientId);
    expect(linked.body.domainId).toBe(domain.body.id);

    const byClient = await request(app.getHttpServer())
      .get(`/clients/${clientId}/mailboxes`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byClient.body.map((m: { id: string }) => m.id)).toContain(mailbox.body.id);

    const byDomain = await request(app.getHttpServer())
      .get(`/domains/${domain.body.id}/mailboxes`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byDomain.body.map((m: { id: string }) => m.id)).toContain(mailbox.body.id);

    const domainSummary = await request(app.getHttpServer())
      .get(`/domains/${domain.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(domainSummary.body.mailboxCount).toBe(1);
  });

  it('an executive only sees clients/domains/mailboxes assigned to them (self-service scoping)', async () => {
    const { id: executiveId, token: executiveToken } = await createExecutive(
      'scoped.exec.e2e@mejoreferido.cl',
    );
    const { clientId } = await linkClientMailbox(app, adminToken, adminUserId);
    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: 'defontana-e2e.cl' });
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload('ventas@defontana-e2e.cl'));
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });

    const beforeAssignment = await request(app.getHttpServer())
      .get('/me/clients')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(beforeAssignment.body.map((c: { id: string }) => c.id)).not.toContain(clientId);

    await request(app.getHttpServer())
      .put(`/clients/${clientId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailbox.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });

    const afterAssignment = await request(app.getHttpServer())
      .get('/me/clients')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(afterAssignment.body.map((c: { id: string }) => c.id)).toContain(clientId);

    const myDomains = await request(app.getHttpServer())
      .get(`/me/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(myDomains.body.map((d: { id: string }) => d.id)).toContain(domain.body.id);

    const myMailboxes = await request(app.getHttpServer())
      .get(`/me/domains/${domain.body.id}/mailboxes`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(myMailboxes.body.map((m: { id: string }) => m.id)).toContain(mailbox.body.id);

    // A client this executive was never assigned to must respond as nonexistent.
    const { clientId: otherClientId } = await linkClientMailbox(app, adminToken, adminUserId);
    const forbidden = await request(app.getHttpServer())
      .get(`/me/clients/${otherClientId}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(forbidden.status).toBe(404);
  });

  it('syncs conversations from the mock engine, then classifies/tags/notes/assigns/resolves/reopens one', async () => {
    const { clientId } = await linkClientMailbox(app, adminToken, adminUserId);
    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: 'conversaciones-e2e.cl' });
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload('ventas@conversaciones-e2e.cl'));
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });

    const list = await request(app.getHttpServer())
      .get(`/conversations?clientId=${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    for (const conversation of list.body) {
      expect(conversation.clientId).toBe(clientId);
      expect(conversation.domainId).toBe(domain.body.id);
      expect(conversation.isUnmatched).toBe(false);
    }

    const conversationId = list.body[0].id;

    const classified = await request(app.getHttpServer())
      .patch(`/conversations/${conversationId}/classification`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ classification: 'INTERESTED' });
    expect(classified.body.classification).toBe('INTERESTED');

    const tag = await request(app.getHttpServer())
      .post('/conversation-tags')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reunión agendada', color: '#8B3FC9' });
    expect(tag.status).toBe(201);

    await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/tags`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tagId: tag.body.id });

    const note = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'El prospecto pidió que lo llamemos el jueves.' });
    expect(note.status).toBe(201);
    expect(note.body.content).toContain('jueves');

    const { id: executiveId } = await createExecutive('asignado.conversacion.e2e@mejoreferido.cl');
    const assigned = await request(app.getHttpServer())
      .patch(`/conversations/${conversationId}/assignment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assignedExecutiveId: executiveId });
    expect(assigned.body.assignedExecutiveId).toBe(executiveId);

    const resolved = await request(app.getHttpServer())
      .patch(`/conversations/${conversationId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ managementStatus: 'RESOLVED' });
    expect(resolved.body.managementStatus).toBe('RESOLVED');
    expect(resolved.body.resolvedAt).not.toBeNull();

    const reopened = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reopened.body.managementStatus).toBe('IN_PROGRESS');

    const detail = await request(app.getHttpServer())
      .get(`/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.tagIds).toContain(tag.body.id);
    expect(detail.body.notes).toHaveLength(1);
    expect(detail.body.messages.length).toBeGreaterThan(0);
  });

  it('a human reply auto-pauses the sequence sending from that mailbox, preserving audit trail', async () => {
    const { id: executiveId, token: executiveToken } = await createExecutive(
      'autopausa.e2e@mejoreferido.cl',
    );

    const { clientId } = await linkClientMailbox(app, adminToken, adminUserId);
    await request(app.getHttpServer())
      .put(`/clients/${clientId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });
    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: 'autopausa-e2e.cl' });
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload('ventas@autopausa-e2e.cl'));
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailbox.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });

    const sequence = await request(app.getHttpServer())
      .post(`/users/${executiveId}/sequences`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Secuencia auto-pausa E2E', timezone: 'America/Santiago' });
    const withMailbox = await request(app.getHttpServer())
      .patch(`/sequences/${sequence.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mailboxId: mailbox.body.id });
    expect(withMailbox.body.status).toBe('DRAFT');

    // Triggers the on-demand sync — a demo thread classifies as a human
    // reply (or bounce/unsubscribe) and, because this mailbox has exactly
    // one DRAFT sequence sending from it, gets associated and auto-pauses it.
    await request(app.getHttpServer())
      .get('/me/conversations')
      .set('Authorization', `Bearer ${executiveToken}`);

    const afterSync = await request(app.getHttpServer())
      .get(`/sequences/${sequence.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterSync.body.status).toBe('PAUSED');

    const auditLog = await request(app.getHttpServer())
      .get(`/users/${executiveId}/audit-log`)
      .set('Authorization', `Bearer ${adminToken}`);
    const actions = auditLog.body.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('sequence.auto_pause');
  });

  it('conversations from a mailbox with no client/domain show up in "Mensajes sin identificar"', async () => {
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload('sinclasificar@example.com'));

    const unmatched = await request(app.getHttpServer())
      .get('/unmatched-messages')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(unmatched.status).toBe(200);
    const forThisMailbox = unmatched.body.filter(
      (c: { mailboxId: string }) => c.mailboxId === mailbox.body.id,
    );
    expect(forThisMailbox.length).toBeGreaterThan(0);
    expect(forThisMailbox.every((c: { isUnmatched: boolean }) => c.isUnmatched)).toBe(true);
  });
});
