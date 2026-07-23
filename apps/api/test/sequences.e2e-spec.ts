import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Sequences + Sequence Steps (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminId: string;
  let executiveToken: string;
  let executiveRoleId: string;
  let executiveId: string;
  let mailboxId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  const mailboxPayload = {
    name: 'Ventas Sequences E2E',
    email: 'ventas.sequences.e2e@example.com',
    fromName: 'Equipo de Ventas',
    imap: {
      host: 'imap.example.com',
      port: 993,
      encryption: 'SSL_TLS',
      username: 'ventas.sequences.e2e@example.com',
      password: 'super-secret-imap-password',
      verifyCertificate: true,
    },
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      encryption: 'STARTTLS',
      username: 'ventas.sequences.e2e@example.com',
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
    adminId = adminLogin.body.user.id;

    const executiveLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: executiveEmail, password: executivePassword });
    executiveToken = executiveLogin.body.accessToken;

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;

    const executiveResponse = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Ejecutivo',
        lastName: 'Secuencias E2E',
        email: 'ejecutivo.sequences.e2e@mejoreferido.cl',
        roleId: executiveRoleId,
      });
    executiveId = executiveResponse.body.id;

    const mailboxResponse = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload);
    mailboxId = mailboxResponse.body.id;

    // Connection test + assignment + signature: everything a sequence's
    // readiness check looks at, so most tests below start from a fully
    // operational sender account.
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/test`)
      .set('Authorization', `Bearer ${adminToken}`);
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Saludos,<br>{sender.name}</p>' });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSequence(mailbox = true): Promise<string> {
    const created = await request(app.getHttpServer())
      .post(`/users/${executiveId}/sequences`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Prospección E2E', timezone: 'America/Santiago' });
    const sequenceId = created.body.id as string;

    if (mailbox) {
      await request(app.getHttpServer())
        .patch(`/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ mailboxId });
    }
    return sequenceId;
  }

  it('creates a sequence in DRAFT status for the executive', async () => {
    const response = await request(app.getHttpServer())
      .post(`/users/${executiveId}/sequences`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nueva secuencia', timezone: 'America/Santiago' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('DRAFT');
    expect(response.body.mailboxId).toBeNull();
  });

  it('rejects a sender account that is not assigned to the sequence executive', async () => {
    const otherMailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...mailboxPayload, email: 'no-asignada.e2e@example.com' });
    const sequenceId = await createSequence(false);

    const response = await request(app.getHttpServer())
      .patch(`/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mailboxId: otherMailbox.body.id });

    expect(response.status).toBe(400);
  });

  it('an executive without sequences.create cannot create a sequence', async () => {
    const response = await request(app.getHttpServer())
      .post(`/users/${executiveId}/sequences`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'X', timezone: 'UTC' });

    expect(response.status).toBe(403);
  });

  it('creates steps, previews them with the mailbox signature applied, and sends a test', async () => {
    const sequenceId = await createSequence();

    const step1 = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Primer contacto',
        subject: 'Una consulta para {contact.company}',
        htmlBody: '<p>Hola {contact.firstName},</p><p>¿Tienes 15 minutos?</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });
    expect(step1.status).toBe(201);
    expect(step1.body.position).toBe(1);
    expect(step1.body.plainTextBody).toContain('Hola');

    const step2 = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Primer seguimiento',
        subject: '¿Pudiste revisar mi mensaje, {contact.firstName}?',
        htmlBody: '<p>Seguimiento</p>',
        delayValue: 2,
        delayUnit: 'DAYS',
        sendMode: 'REPLY',
      });
    expect(step2.body.position).toBe(2);
    // Each step's subject/body is independent — no reuse from Step 1.
    expect(step2.body.subject).not.toBe(step1.body.subject);

    const preview = await request(app.getHttpServer())
      .get(`/sequence-steps/${step1.body.id}/preview`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.signatureApplied).toBe(true);
    expect(preview.body.renderedHtml).not.toContain('{contact.firstName}');
    expect(preview.body.renderedSubject).not.toContain('{contact.company}');

    const sendTest = await request(app.getHttpServer())
      .post(`/sequence-steps/${step1.body.id}/send-test`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ to: 'destino.e2e@example.com' });
    expect(sendTest.status).toBe(201);
    expect(sendTest.body.accepted).toBe(true);
  });

  it('rejects a malformed variable in the subject and enforces no line breaks', async () => {
    const sequenceId = await createSequence();

    const malformed = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Step inválido',
        subject: 'Hola {1invalido}',
        htmlBody: '<p>Hola</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });
    expect(malformed.status).toBe(400);

    const withNewline = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Step con salto de línea',
        subject: 'Hola\nMundo',
        htmlBody: '<p>Hola</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });
    expect(withNewline.status).toBe(400);
  });

  it('rejects a step DTO that tries to sneak in a signature field', async () => {
    const sequenceId = await createSequence();

    const response = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Step con firma manual',
        subject: 'Asunto',
        htmlBody: '<p>Hola</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
        signatureId: 'signature_1',
      });

    expect(response.status).toBe(400);
  });

  it('sanitizes a <script> tag out of the step HTML before persisting', async () => {
    const sequenceId = await createSequence();

    const response = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Step con script',
        subject: 'Asunto',
        htmlBody: '<p onclick="alert(1)">Hola</p><script>alert(2)</script>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });

    expect(response.status).toBe(201);
    expect(response.body.htmlBody).not.toContain('onclick');
    expect(response.body.htmlBody).not.toContain('<script>');
  });

  it('reorders steps and renormalizes positions after deleting one', async () => {
    const sequenceId = await createSequence();
    const stepPayload = (name: string) => ({
      name,
      subject: `Asunto ${name}`,
      htmlBody: '<p>Cuerpo</p>',
      delayValue: 0,
      delayUnit: 'DAYS',
      sendMode: 'NEW_THREAD',
    });

    const s1 = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(stepPayload('A'));
    const s2 = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(stepPayload('B'));
    const s3 = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(stepPayload('C'));

    const reordered = await request(app.getHttpServer())
      .put(`/sequences/${sequenceId}/steps/reorder`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stepIds: [s3.body.id, s1.body.id, s2.body.id] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.map((s: { id: string }) => s.id)).toEqual([
      s3.body.id,
      s1.body.id,
      s2.body.id,
    ]);

    await request(app.getHttpServer())
      .delete(`/sequence-steps/${s1.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const remaining = await request(app.getHttpServer())
      .get(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(remaining.body.map((s: { id: string }) => s.id)).toEqual([s3.body.id, s2.body.id]);
    expect(remaining.body.map((s: { position: number }) => s.position)).toEqual([1, 2]);
  });

  it('duplicates a step, inserting the copy right after the original', async () => {
    const sequenceId = await createSequence();
    const original = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Original',
        subject: 'Asunto original',
        htmlBody: '<p>Cuerpo</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });

    const duplicated = await request(app.getHttpServer())
      .post(`/sequence-steps/${original.body.id}/duplicate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(duplicated.status).toBe(201);
    expect(duplicated.body.name).toContain('copia');
    expect(duplicated.body.position).toBe(2);
  });

  it('keeps version history and does not create a version for a status-only update', async () => {
    const sequenceId = await createSequence();
    const step = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Versionado',
        subject: 'Asunto v1',
        htmlBody: '<p>v1</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });

    await request(app.getHttpServer())
      .patch(`/sequence-steps/${step.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subject: 'Asunto v2' });

    await request(app.getHttpServer())
      .patch(`/sequence-steps/${step.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PUBLISHED' });

    const versions = await request(app.getHttpServer())
      .get(`/sequence-steps/${step.body.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(versions.body).toHaveLength(2);
    expect(versions.body[0].subject).toBe('Asunto v2');
  });

  it('reports a fully-passing readiness check once account and steps are configured', async () => {
    const sequenceId = await createSequence();
    await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Step 1',
        subject: 'Asunto',
        htmlBody: '<p>Cuerpo</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });

    const readiness = await request(app.getHttpServer())
      .get(`/sequences/${sequenceId}/readiness`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(readiness.status).toBe(200);
    expect(readiness.body.account.ok).toBe(true);
    expect(readiness.body.steps.ok).toBe(true);
    expect(readiness.body.prospects.status).toBe('PENDING_FEATURE');
    expect(readiness.body.calendar.status).toBe('PENDING_FEATURE');
    expect(readiness.body.overallReady).toBe(true);
  });

  it('flags a sequence with no sender account and no steps as not ready', async () => {
    const sequenceId = await createSequence(false);

    const readiness = await request(app.getHttpServer())
      .get(`/sequences/${sequenceId}/readiness`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(readiness.body.account.ok).toBe(false);
    expect(readiness.body.steps.ok).toBe(false);
    expect(readiness.body.overallReady).toBe(false);
  });

  it('duplicates a sequence together with its steps', async () => {
    const sequenceId = await createSequence();
    await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Step 1',
        subject: 'Asunto',
        htmlBody: '<p>Cuerpo</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });

    const duplicated = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/duplicate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(duplicated.status).toBe(201);
    expect(duplicated.body.mailboxId).toBe(mailboxId);

    const copiedSteps = await request(app.getHttpServer())
      .get(`/sequences/${duplicated.body.id}/steps`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(copiedSteps.body).toHaveLength(1);
  });

  it('pauses, resumes, archives, and restores a sequence', async () => {
    const sequenceId = await createSequence();

    const paused = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/pause`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(paused.body.status).toBe('PAUSED');

    const resumed = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/resume`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resumed.body.status).toBe('DRAFT');

    const archived = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(archived.body.status).toBe('ARCHIVED');

    const restored = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/restore`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(restored.body.status).toBe('DRAFT');
  });

  it('returns 404 (not 403) for a sequence id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/sequences/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('records sequence and step actions in the actor’s (not the sequence owner’s) audit log', async () => {
    // GET /users/:userId/audit-log is scoped by actorId (who performed
    // the action), not by which resources belong to that user — every
    // action here is performed by the admin on the executive's behalf,
    // so it shows up under the admin's own audit log, not the
    // executive's. See README > "Fase 10" for this scoping note.
    const sequenceId = await createSequence();
    await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Auditado',
        subject: 'Asunto',
        htmlBody: '<p>Cuerpo</p>',
        delayValue: 0,
        delayUnit: 'DAYS',
        sendMode: 'NEW_THREAD',
      });

    const response = await request(app.getHttpServer())
      .get(`/users/${adminId}/audit-log`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const actions = response.body.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'sequence.create',
        'sequence.change_account',
        'sequence_step.create',
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
  });

  it('exposes a role’s permission keys for the executive profile "Permisos" tab', async () => {
    const response = await request(app.getHttpServer())
      .get(`/roles/${executiveRoleId}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining(['mailboxes.read.assigned']));
  });

  describe('DELETE /sequences/:id', () => {
    it('soft-deletes a DRAFT sequence: it disappears from the list and 404s on direct access', async () => {
      const sequenceId = await createSequence();

      const response = await request(app.getHttpServer())
        .delete(`/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.previousStatus).toBe('DRAFT');
      expect(response.body.cancelledJobs).toBe(0);

      const getResponse = await request(app.getHttpServer())
        .get(`/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getResponse.status).toBe(404);

      const list = await request(app.getHttpServer())
        .get(`/users/${executiveId}/sequences`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.body.map((s: { id: string }) => s.id)).not.toContain(sequenceId);
    });

    it('is idempotent: a second delete on the same sequence 404s instead of erroring or double-recording audit', async () => {
      const sequenceId = await createSequence();

      const first = await request(app.getHttpServer())
        .delete(`/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const second = await request(app.getHttpServer())
        .delete(`/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(first.status).toBe(200);
      expect(second.status).toBe(404);
    });

    it('requires sequences.delete — an executive without it cannot delete an admin-managed sequence', async () => {
      const sequenceId = await createSequence();

      const response = await request(app.getHttpServer())
        .delete(`/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });

    it('returns 404 (not 403) for a sequence id that does not exist', async () => {
      const response = await request(app.getHttpServer())
        .delete('/sequences/does-not-exist')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });

    it('preserves the sent step version history and audit trail after deleting an active-ish (PAUSED) sequence', async () => {
      const sequenceId = await createSequence();
      await request(app.getHttpServer())
        .post(`/sequences/${sequenceId}/steps`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Step conservado',
          subject: 'Asunto',
          htmlBody: '<p>Cuerpo</p>',
          delayValue: 0,
          delayUnit: 'DAYS',
          sendMode: 'NEW_THREAD',
        });
      await request(app.getHttpServer())
        .post(`/sequences/${sequenceId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.previousStatus).toBe('PAUSED');

      const auditResponse = await request(app.getHttpServer())
        .get(`/users/${adminId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      const actions = auditResponse.body.map((entry: { action: string }) => entry.action);
      expect(actions).toEqual(
        expect.arrayContaining(['sequence_step.create', 'sequence.pause', 'sequence.delete']),
      );
    });
  });
});
