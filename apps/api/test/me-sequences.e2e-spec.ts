import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive } from './fixtures';

describe('Self-service sequences, steps and inbox under /me (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveRoleId: string;
  let executiveToken: string;
  let executiveId: string;
  let assignedMailboxId: string;
  let unassignedMailboxId: string;

  const mailboxPayload = (email: string) => ({
    name: 'Ventas Me E2E',
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

  beforeAll(async () => {
    app = await createTestApp();

    const adminLogin = await request(app.getHttpServer()).post('/auth/login').send({
      email: process.env.DEV_ADMIN_EMAIL,
      password: process.env.DEV_ADMIN_PASSWORD,
    });
    adminToken = adminLogin.body.accessToken;

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;

    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutivo Self-Service E2E',
      email: 'ejecutivo.me.e2e@mejoreferido.cl',
      roleId: executiveRoleId,
    });
    executiveId = executive.id;
    executiveToken = executive.token;

    const assignedMailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload('ventas.me.e2e@example.com'));
    assignedMailboxId = assignedMailbox.body.id;
    await request(app.getHttpServer())
      .post(`/mailboxes/${assignedMailboxId}/test`)
      .set('Authorization', `Bearer ${adminToken}`);
    await request(app.getHttpServer())
      .put(`/mailboxes/${assignedMailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });
    await request(app.getHttpServer())
      .post(`/mailboxes/${assignedMailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Saludos,<br>{sender.name}</p>' });

    const unassignedMailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload('soporte.me.e2e@example.com'));
    unassignedMailboxId = unassignedMailbox.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the executive create, read and configure their own sequence end to end', async () => {
    const created = await request(app.getHttpServer())
      .post('/me/sequences')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'Mi secuencia', timezone: 'America/Santiago' });
    expect(created.status).toBe(201);
    expect(created.body.executiveId).toBe(executiveId);
    const sequenceId = created.body.id;

    const setAccount = await request(app.getHttpServer())
      .patch(`/me/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ mailboxId: assignedMailboxId });
    expect(setAccount.status).toBe(200);
    expect(setAccount.body.mailboxId).toBe(assignedMailboxId);

    const step = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({
        name: 'Step 1',
        subject: 'Hola {contact.firstName}',
        htmlBody: '<p>Contenido del step</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });
    expect(step.status).toBe(201);
    const stepId = step.body.id;

    const list = await request(app.getHttpServer())
      .get('/me/sequences')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(list.body.map((s: { id: string }) => s.id)).toContain(sequenceId);

    const readiness = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/readiness`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(readiness.status).toBe(200);
    expect(readiness.body.account.ok).toBe(true);
    expect(readiness.body.steps.ok).toBe(true);

    const preview = await request(app.getHttpServer())
      .get(`/me/sequence-steps/${stepId}/preview`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.signatureApplied).toBe(true);

    const sendTest = await request(app.getHttpServer())
      .post(`/me/sequence-steps/${stepId}/send-test`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ to: 'prueba@example.com' });
    expect(sendTest.status).toBe(201);
    expect(sendTest.body.accepted).toBe(true);

    const duplicated = await request(app.getHttpServer())
      .post(`/me/sequence-steps/${stepId}/duplicate`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(duplicated.status).toBe(201);

    const reordered = await request(app.getHttpServer())
      .put(`/me/sequences/${sequenceId}/steps/reorder`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ stepIds: [duplicated.body.id, stepId] });
    expect(reordered.status).toBe(200);
    expect(reordered.body[0].id).toBe(duplicated.body.id);

    const paused = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/pause`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(paused.body.status).toBe('PAUSED');

    const resumed = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/resume`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(resumed.body.status).toBe('DRAFT');

    const archived = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/archive`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(archived.body.status).toBe('ARCHIVED');
  });

  it('rejects setting a mailbox that is not assigned to the executive', async () => {
    const created = await request(app.getHttpServer())
      .post('/me/sequences')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'Secuencia con cuenta ajena', timezone: 'America/Santiago' });

    const response = await request(app.getHttpServer())
      .patch(`/me/sequences/${created.body.id}`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ mailboxId: unassignedMailboxId });

    expect(response.status).toBe(400);
  });

  it('returns 404 (not 403) for a sequence belonging to a different executive', async () => {
    const otherExecutive = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Otro',
        lastName: 'Ejecutivo E2E',
        email: 'otro.ejecutivo.me.e2e@mejoreferido.cl',
        roleId: executiveRoleId,
      });

    const othersSequence = await request(app.getHttpServer())
      .post(`/users/${otherExecutive.body.id}/sequences`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Secuencia de otro ejecutivo', timezone: 'America/Santiago' });

    const getResponse = await request(app.getHttpServer())
      .get(`/me/sequences/${othersSequence.body.id}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(getResponse.status).toBe(404);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/me/sequences/${othersSequence.body.id}`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'Intento de secuestro' });
    expect(updateResponse.status).toBe(404);
  });

  it('returns 404 (not 403) for a step belonging to a different executive', async () => {
    const otherSequence = await request(app.getHttpServer())
      .post('/me/sequences')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'Secuencia con step ajeno', timezone: 'America/Santiago' });
    const step = await request(app.getHttpServer())
      .post(`/me/sequences/${otherSequence.body.id}/steps`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({
        name: 'Step ajeno',
        subject: 'Asunto',
        htmlBody: '<p>Cuerpo</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });

    const thirdExecutive = await createReadyExecutive(app, adminToken, {
      name: 'Tercer Ejecutivo E2E',
      email: 'tercer.ejecutivo.me.e2e@mejoreferido.cl',
      roleId: executiveRoleId,
    });

    const response = await request(app.getHttpServer())
      .get(`/me/sequence-steps/${step.body.id}`)
      .set('Authorization', `Bearer ${thirdExecutive.token}`);

    expect(response.status).toBe(404);
  });

  describe('inbox self-service', () => {
    it('reads the demo inbox for a mailbox assigned to the executive', async () => {
      const response = await request(app.getHttpServer())
        .get(`/me/mailboxes/${assignedMailboxId}/inbox`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('OK');
      expect(response.body.threads.length).toBeGreaterThan(0);
    });

    it('opens a thread from the assigned mailbox', async () => {
      const inbox = await request(app.getHttpServer())
        .get(`/me/mailboxes/${assignedMailboxId}/inbox`)
        .set('Authorization', `Bearer ${executiveToken}`);
      const threadId = inbox.body.threads[0].id;

      const thread = await request(app.getHttpServer())
        .get(`/me/mailboxes/${assignedMailboxId}/inbox/threads/${threadId}`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(thread.status).toBe(200);
      expect(thread.body.status).toBe('OK');
      expect(thread.body.messages.length).toBeGreaterThan(0);
    });

    it('returns 404 (not 403) for a mailbox that is not assigned to the executive', async () => {
      const response = await request(app.getHttpServer())
        .get(`/me/mailboxes/${unassignedMailboxId}/inbox`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('read-state self-service', () => {
    it('marks a thread read, and it stays read across a fresh fetch', async () => {
      const inbox = await request(app.getHttpServer())
        .get(`/me/mailboxes/${assignedMailboxId}/inbox`)
        .set('Authorization', `Bearer ${executiveToken}`);
      const threadId = inbox.body.threads[0].id;

      const markRead = await request(app.getHttpServer())
        .post(`/me/mailboxes/${assignedMailboxId}/inbox/threads/${threadId}/read-state`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ isUnread: false });
      expect(markRead.status).toBe(201);
      expect(markRead.body.status).toBe('OK');

      const after = await request(app.getHttpServer())
        .get(`/me/mailboxes/${assignedMailboxId}/inbox`)
        .set('Authorization', `Bearer ${executiveToken}`);
      const updatedThread = after.body.threads.find((t: { id: string }) => t.id === threadId);
      expect(updatedThread.unreadCount).toBe(0);
    });

    it('returns 404 (not 403) for a mailbox that is not assigned to the executive', async () => {
      const response = await request(app.getHttpServer())
        .post(`/me/mailboxes/${unassignedMailboxId}/inbox/threads/any/read-state`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ isUnread: false });

      expect(response.status).toBe(404);
    });
  });

  describe('signature self-service', () => {
    it('reads the signature the admin created for the assigned mailbox', async () => {
      const response = await request(app.getHttpServer())
        .get(`/me/mailboxes/${assignedMailboxId}/signature`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(200);
      expect(response.body.activeVersion.htmlContent).toContain('Saludos');
    });

    it('saves a new version (update, not create) when a signature already exists', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/me/mailboxes/${assignedMailboxId}/signature`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ htmlContent: '<p>Firma editada por el propio ejecutivo</p>' });

      expect(response.status).toBe(200);
      expect(response.body.activeVersion.htmlContent).toContain('editada por el propio ejecutivo');
      expect(response.body.versions.length).toBeGreaterThan(1);
    });

    it('previews and sends a test using the assigned mailbox signature', async () => {
      const preview = await request(app.getHttpServer())
        .get(`/me/mailboxes/${assignedMailboxId}/signature/preview`)
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(preview.status).toBe(200);

      const sendTest = await request(app.getHttpServer())
        .post(`/me/mailboxes/${assignedMailboxId}/signature/send-test`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ to: 'prueba@example.com' });
      expect(sendTest.status).toBe(201);
      expect(sendTest.body.accepted).toBe(true);
    });

    it('returns 404 (not 403) for a mailbox not assigned to the executive — never leaks a colleague’s signature', async () => {
      const getResponse = await request(app.getHttpServer())
        .get(`/me/mailboxes/${unassignedMailboxId}/signature`)
        .set('Authorization', `Bearer ${executiveToken}`);
      const patchResponse = await request(app.getHttpServer())
        .patch(`/me/mailboxes/${unassignedMailboxId}/signature`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ htmlContent: '<p>Intento ajeno</p>' });

      expect(getResponse.status).toBe(404);
      expect(patchResponse.status).toBe(404);
    });
  });

  describe('DELETE /me/sequences/:id', () => {
    it('lets the executive delete their own sequence — it disappears from their list', async () => {
      const created = await request(app.getHttpServer())
        .post('/me/sequences')
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ name: 'Secuencia a eliminar', timezone: 'America/Santiago' });

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/me/sequences/${created.body.id}`)
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(deleteResponse.status).toBe(200);

      const list = await request(app.getHttpServer())
        .get('/me/sequences')
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(list.body.map((s: { id: string }) => s.id)).not.toContain(created.body.id);
    });

    it('returns 404 (not 403) when trying to delete a colleague’s sequence', async () => {
      const otherExecutive = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Cuarto',
          lastName: 'Ejecutivo E2E',
          email: 'cuarto.ejecutivo.me.e2e@mejoreferido.cl',
          roleId: executiveRoleId,
        });
      const othersSequence = await request(app.getHttpServer())
        .post(`/users/${otherExecutive.body.id}/sequences`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Secuencia ajena', timezone: 'America/Santiago' });

      const response = await request(app.getHttpServer())
        .delete(`/me/sequences/${othersSequence.body.id}`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(404);
    });
  });
});
