import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive } from './fixtures';

describe('Mailboxes (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;
  let executiveRoleId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  async function createExecutive(email: string) {
    return createReadyExecutive(app, adminToken, { name: 'Ejecutivo Asignable', email, roleId: executiveRoleId });
  }

  const createPayload = {
    name: 'Ventas E2E',
    email: 'ventas.e2e@example.com',
    fromName: 'Equipo de Ventas',
    imap: {
      host: 'imap.example.com',
      port: 993,
      encryption: 'SSL_TLS',
      username: 'ventas.e2e@example.com',
      password: 'super-secret-imap-password',
      verifyCertificate: true,
    },
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      encryption: 'STARTTLS',
      username: 'ventas.e2e@example.com',
      password: 'super-secret-smtp-password',
      verifyCertificate: true,
    },
  };

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

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('an executive (only mailboxes.read.assigned) cannot list or create every mailbox in the org — that requires mailboxes.read.all', async () => {
    const list = await request(app.getHttpServer())
      .get('/mailboxes')
      .set('Authorization', `Bearer ${executiveToken}`);
    const create = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send(createPayload);

    expect(list.status).toBe(403);
    expect(create.status).toBe(403);
  });

  it('admin creates a mailbox; the response never contains the plaintext or encrypted secret anywhere', async () => {
    const response = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.connectionStatus).toBe('NOT_TESTED');
    expect(response.body.imap.credentialsConfigured).toBe(true);
    expect(response.body.smtp.credentialsConfigured).toBe(true);

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('super-secret-imap-password');
    expect(raw).not.toContain('super-secret-smtp-password');
    expect(raw).not.toMatch(/secretCiphertext/i);
    expect(raw).not.toMatch(/"password"/i);
  });

  it('admin lists mailboxes and sees the created one, still with no secret anywhere', async () => {
    const response = await request(app.getHttpServer())
      .get('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const emails = response.body.map((m: { email: string }) => m.email);
    expect(emails).toContain('ventas.e2e@example.com');
    expect(JSON.stringify(response.body)).not.toContain('super-secret-imap-password');
  });

  it('admin edits the name without needing to resend the password', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'editable.e2e@example.com' });

    const updated = await request(app.getHttpServer())
      .patch(`/mailboxes/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ventas Renombrada' });

    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Ventas Renombrada');
    expect(updated.body.imap.credentialsConfigured).toBe(true);
  });

  it('deactivating and reactivating a mailbox updates its administrative status', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'togglable.e2e@example.com' });

    const deactivated = await request(app.getHttpServer())
      .post(`/mailboxes/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivated.body.status).toBe('INACTIVE');

    const reactivated = await request(app.getHttpServer())
      .post(`/mailboxes/${created.body.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivated.body.status).toBe('ACTIVE');
  });

  it('rejects a duplicate email within the organization', async () => {
    const response = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload);

    expect(response.status).toBe(409);
  });

  it('returns 404 for a mailbox id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/mailboxes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('an executive cannot trigger a connection test', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'perm-check.e2e@example.com' });

    const response = await request(app.getHttpServer())
      .post(`/mailboxes/${created.body.id}/test`)
      .set('Authorization', `Bearer ${executiveToken}`);

    expect(response.status).toBe(403);
  });

  it('a successful test updates connectionStatus, records history, and leaks no secret', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'test-success.e2e@example.com' });

    const testResponse = await request(app.getHttpServer())
      .post(`/mailboxes/${created.body.id}/test`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(testResponse.status).toBe(201);
    expect(testResponse.body.status).toBe('CONNECTED');
    const raw = JSON.stringify(testResponse.body);
    expect(raw).not.toContain('super-secret-imap-password');
    expect(raw).not.toContain('super-secret-smtp-password');

    const mailbox = await request(app.getHttpServer())
      .get(`/mailboxes/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(mailbox.body.connectionStatus).toBe('CONNECTED');
    expect(mailbox.body.lastTestedAt).not.toBeNull();

    const history = await request(app.getHttpServer())
      .get(`/mailboxes/${created.body.id}/connection-tests`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].status).toBe('CONNECTED');
    expect(history.body[0].executedBy).toBeTruthy();
    expect(JSON.stringify(history.body)).not.toContain('super-secret-imap-password');
  });

  it('the "+tag" mock convention drives a deterministic partial-connection result', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'ventas+smtpdown@example.com' });

    const testResponse = await request(app.getHttpServer())
      .post(`/mailboxes/${created.body.id}/test`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(testResponse.body.status).toBe('PARTIALLY_CONNECTED');
    expect(testResponse.body.imap.success).toBe(true);
    expect(testResponse.body.smtp.success).toBe(false);

    const history = await request(app.getHttpServer())
      .get(`/mailboxes/${created.body.id}/connection-tests`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(history.body[0].status).toBe('PARTIALLY_CONNECTED');
    expect(history.body[0].smtpErrorCode).toBeTruthy();
  });

  it('running two tests keeps both in history, most recent first', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'ventas+timeout@example.com' });

    await request(app.getHttpServer())
      .post(`/mailboxes/${created.body.id}/test`)
      .set('Authorization', `Bearer ${adminToken}`);
    await request(app.getHttpServer())
      .post(`/mailboxes/${created.body.id}/test`)
      .set('Authorization', `Bearer ${adminToken}`);

    const history = await request(app.getHttpServer())
      .get(`/mailboxes/${created.body.id}/connection-tests`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(history.body).toHaveLength(2);
    expect(history.body[0].status).toBe('CONNECTION_ERROR');
    expect(history.body[1].status).toBe('CONNECTION_ERROR');
  });

  describe('inbox', () => {
    it('an executive (only mailboxes.read.assigned) cannot read an inbox', async () => {
      const created = await request(app.getHttpServer())
        .post('/mailboxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...createPayload, email: 'inbox-perm.e2e@example.com' });

      const response = await request(app.getHttpServer())
        .get(`/mailboxes/${created.body.id}/inbox`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });

    it('returns demo threads for a healthy mailbox, with no secret leaked', async () => {
      const created = await request(app.getHttpServer())
        .post('/mailboxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...createPayload, email: 'inbox-demo.e2e@example.com' });

      const response = await request(app.getHttpServer())
        .get(`/mailboxes/${created.body.id}/inbox`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('OK');
      expect(response.body.threads.length).toBeGreaterThan(0);
      expect(JSON.stringify(response.body)).not.toContain('super-secret-imap-password');
    });

    it('fetching the same mailbox twice returns the same thread ids, in the same order', async () => {
      const created = await request(app.getHttpServer())
        .post('/mailboxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...createPayload, email: 'inbox-deterministic.e2e@example.com' });

      const first = await request(app.getHttpServer())
        .get(`/mailboxes/${created.body.id}/inbox`)
        .set('Authorization', `Bearer ${adminToken}`);
      const second = await request(app.getHttpServer())
        .get(`/mailboxes/${created.body.id}/inbox`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(first.body.threads.map((t: { id: string }) => t.id)).toEqual(
        second.body.threads.map((t: { id: string }) => t.id),
      );
    });

    it('opens a thread returned by the inbox listing and gets its messages', async () => {
      const created = await request(app.getHttpServer())
        .post('/mailboxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...createPayload, email: 'inbox-thread.e2e@example.com' });

      const inbox = await request(app.getHttpServer())
        .get(`/mailboxes/${created.body.id}/inbox`)
        .set('Authorization', `Bearer ${adminToken}`);
      const threadId = inbox.body.threads[0].id;

      const thread = await request(app.getHttpServer())
        .get(`/mailboxes/${created.body.id}/inbox/threads/${threadId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(thread.status).toBe(200);
      expect(thread.body.status).toBe('OK');
      expect(thread.body.messages.length).toBeGreaterThan(0);
      expect(thread.body.messages.every((m: { threadId: string }) => m.threadId === threadId)).toBe(
        true,
      );
    });

    it('returns NOT_FOUND for a thread id that does not exist on that mailbox', async () => {
      const created = await request(app.getHttpServer())
        .post('/mailboxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...createPayload, email: 'inbox-missing-thread.e2e@example.com' });

      const thread = await request(app.getHttpServer())
        .get(`/mailboxes/${created.body.id}/inbox/threads/does-not-exist`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(thread.status).toBe(200);
      expect(thread.body.status).toBe('NOT_FOUND');
      expect(thread.body.messages).toEqual([]);
    });

    it('the "+tag" convention reports ENGINE_UNAVAILABLE with an empty thread list', async () => {
      const created = await request(app.getHttpServer())
        .post('/mailboxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...createPayload, email: 'inboxmotorcaido+motorcaido@example.com' });

      const response = await request(app.getHttpServer())
        .get(`/mailboxes/${created.body.id}/inbox`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.body.status).toBe('ENGINE_UNAVAILABLE');
      expect(response.body.threads).toEqual([]);
    });

    it('returns 404 (not 403) for an inbox on a mailbox id that does not exist', async () => {
      const response = await request(app.getHttpServer())
        .get('/mailboxes/does-not-exist/inbox')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  it('a new mailbox starts with no assignees', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'unassigned.e2e@example.com' });

    const assignees = await request(app.getHttpServer())
      .get(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(assignees.status).toBe(200);
    expect(assignees.body).toEqual([]);
  });

  it('admin assigns an executive to a mailbox and the executive sees it in GET /me/mailboxes', async () => {
    const { id: executiveId, token: assigneeToken } = await createExecutive('asignado.e2e@mejoreferido.cl');
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'para-asignar.e2e@example.com' });

    const setResponse = await request(app.getHttpServer())
      .put(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });

    expect(setResponse.status).toBe(200);
    expect(setResponse.body).toEqual([
      {
        id: executiveId,
        name: 'Ejecutivo Asignable',
        email: 'asignado.e2e@mejoreferido.cl',
        status: 'ACTIVE',
        role: 'PRIMARY',
      },
    ]);

    const myMailboxes = await request(app.getHttpServer())
      .get('/me/mailboxes')
      .set('Authorization', `Bearer ${assigneeToken}`);

    expect(myMailboxes.status).toBe(200);
    expect(myMailboxes.body).toHaveLength(1);
    expect(myMailboxes.body[0].email).toBe('para-asignar.e2e@example.com');
    expect(myMailboxes.body[0]).not.toHaveProperty('imap');
    expect(myMailboxes.body[0]).not.toHaveProperty('smtp');
    const raw = JSON.stringify(myMailboxes.body);
    expect(raw).not.toContain('super-secret-imap-password');
    expect(raw).not.toContain('super-secret-smtp-password');
  });

  it('an assigned executive can view (but never edit) assignees via GET /me/mailboxes/:id/assignees', async () => {
    const { id: executiveId, token: assigneeToken } = await createExecutive(
      'lector-asignaciones.e2e@mejoreferido.cl',
    );
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'con-asignaciones.e2e@example.com' });

    await request(app.getHttpServer())
      .put(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });

    const myAssignees = await request(app.getHttpServer())
      .get(`/me/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${assigneeToken}`);

    expect(myAssignees.status).toBe(200);
    expect(myAssignees.body).toEqual([
      expect.objectContaining({ id: executiveId, role: 'PRIMARY' }),
    ]);

    // The self-service route is read-only — there is no PUT under /me/mailboxes/:id/assignees.
    const attemptToEdit = await request(app.getHttpServer())
      .put(`/me/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${assigneeToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });
    expect(attemptToEdit.status).toBe(404);
  });

  it('an executive cannot view assignees for a mailbox not assigned to them (404, never 403)', async () => {
    const { token: outsiderToken } = await createExecutive('sin-acceso.e2e@mejoreferido.cl');
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'no-asignada.e2e@example.com' });

    const response = await request(app.getHttpServer())
      .get(`/me/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(404);
  });

  it('replacing the assignee list removes access for whoever is no longer in it', async () => {
    const { id: executiveId, token: assigneeToken } = await createExecutive('removido.e2e@mejoreferido.cl');
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'reasignable.e2e@example.com' });

    await request(app.getHttpServer())
      .put(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: null, secondaryUserIds: [executiveId] });

    await request(app.getHttpServer())
      .put(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: null, secondaryUserIds: [] });

    const myMailboxes = await request(app.getHttpServer())
      .get('/me/mailboxes')
      .set('Authorization', `Bearer ${assigneeToken}`);

    expect(myMailboxes.body).toEqual([]);
  });

  it('rejects assigning a userId that does not belong to the organization', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'invalid-assignee.e2e@example.com' });

    const response = await request(app.getHttpServer())
      .put(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: null, secondaryUserIds: ['00000000-0000-0000-0000-000000000000'] });

    expect(response.status).toBe(400);
  });

  it('an executive without mailboxes.assign cannot manage assignments', async () => {
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'perm-check-assign.e2e@example.com' });

    const response = await request(app.getHttpServer())
      .put(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ primaryUserId: null, secondaryUserIds: [] });

    expect(response.status).toBe(403);
  });

  it('returns 404 (not 403) for assignee endpoints on a mailbox id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/mailboxes/00000000-0000-0000-0000-000000000000/assignees')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('sets one primary and several secondary executives in a single call', async () => {
    const { id: primaryId } = await createExecutive('principal.e2e@mejoreferido.cl');
    const { id: secondaryId } = await createExecutive('secundario.e2e@mejoreferido.cl');
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'roles.e2e@example.com' });

    const response = await request(app.getHttpServer())
      .put(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: primaryId, secondaryUserIds: [secondaryId] });

    expect(response.status).toBe(200);
    const primary = response.body.find((a: { id: string }) => a.id === primaryId);
    const secondary = response.body.find((a: { id: string }) => a.id === secondaryId);
    expect(primary.role).toBe('PRIMARY');
    expect(secondary.role).toBe('SECONDARY');
  });

  it('rejects assigning an inactive executive', async () => {
    const { id: executiveId } = await createExecutive('inactivo.e2e@mejoreferido.cl');
    await request(app.getHttpServer())
      .post(`/users/${executiveId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    const created = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, email: 'inactivo-assignee.e2e@example.com' });

    const response = await request(app.getHttpServer())
      .put(`/mailboxes/${created.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });

    expect(response.status).toBe(400);
  });
});
