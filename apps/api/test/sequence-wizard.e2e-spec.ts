import { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive, linkClientMailbox } from './fixtures';

async function buildXlsxBuffer(headers: string[], rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contactos');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * "Desarrollo de la nueva función Secuencias" — the wizard's step 1
 * ("Configuración general") through publish: auto-generated name, the 3
 * fixed steps (Enviados_1/2/3) with their default triggers/delays and
 * subject-inheritance rules, the §22 publish JSON contract, and the
 * FAILED/retry scenario from §23.
 */
describe('Sequence creation wizard + publish contract (e2e) — memory + simulated engine', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;
  let executiveId: string;
  let clientId: string;
  let mailboxId: string;
  const stamp = Date.now();

  async function loginAs(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return response.body.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAs(process.env.DEV_ADMIN_EMAIL as string, process.env.DEV_ADMIN_PASSWORD as string);

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    const executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;

    const executiveEmail = `sequence-wizard.e2e.${stamp}@mejoreferido.cl`;
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Wizard',
      email: executiveEmail,
      roleId: executiveRoleId,
    });
    executiveId = executive.id;
    executiveToken = executive.token;

    clientId = (await linkClientMailbox(app, adminToken, executiveId)).clientId;
    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: `sequence-wizard-e2e-${stamp}.test` });

    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Ventas Wizard E2E',
        email: `ventas.wizard.${stamp}@example.com`,
        fromName: 'Equipo de Ventas',
        imap: {
          host: 'imap.example.com',
          port: 993,
          encryption: 'SSL_TLS',
          username: `ventas.wizard.${stamp}@example.com`,
          password: 'super-secret-imap-password',
          verifyCertificate: true,
        },
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          encryption: 'STARTTLS',
          username: `ventas.wizard.${stamp}@example.com`,
          password: 'super-secret-smtp-password',
          verifyCertificate: true,
        },
      });
    mailboxId = mailbox.body.id;
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });
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

  it('generates the Gestión_DDMMYYYY name and auto-creates the 3 fixed steps', async () => {
    const response = await request(app.getHttpServer())
      .post('/me/sequences/wizard')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ clientId, mailboxId, managementDate: '2026-07-20' });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('Gestión_20072026');
    expect(response.body.stepPolicy).toBe('FIXED_3');
    expect(response.body.managementDate).toBe('2026-07-20');
    expect(response.body.stepCount).toBe(3);

    const steps = await request(app.getHttpServer())
      .get(`/me/sequences/${response.body.id}/steps`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(steps.body.map((s: { name: string }) => s.name)).toEqual(['Enviados_1', 'Enviados_2', 'Enviados_3']);
    expect(steps.body[0]).toEqual(expect.objectContaining({ delayValue: 0, delayUnit: 'DAYS' }));
    expect(steps.body[1]).toEqual(expect.objectContaining({ delayValue: 5, delayUnit: 'BUSINESS_DAYS' }));
    expect(steps.body[2]).toEqual(expect.objectContaining({ delayValue: 10, delayUnit: 'BUSINESS_DAYS' }));
  });

  describe('fixed-step guardrails', () => {
    let sequenceId: string;
    let step1Id: string;
    let step2Id: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/me/sequences/wizard')
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ clientId, mailboxId, managementDate: '2026-07-21' });
      sequenceId = created.body.id;
      const steps = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/steps`)
        .set('Authorization', `Bearer ${executiveToken}`);
      step1Id = steps.body[0].id;
      step2Id = steps.body[1].id;
    });

    it('rejects adding a 4th step', async () => {
      const response = await request(app.getHttpServer())
        .post(`/me/sequences/${sequenceId}/steps`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ name: 'Enviados_4', subject: 'X', htmlBody: '<p>X</p>', delayValue: 1, delayUnit: 'DAYS', sendMode: 'REPLY' });
      expect(response.status).toBe(400);
    });

    it('rejects deleting a fixed step', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/me/sequence-steps/${step2Id}`)
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(response.status).toBe(400);
    });

    it('rejects renaming a fixed step', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/me/sequence-steps/${step1Id}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ name: 'Otro nombre' });
      expect(response.status).toBe(400);
    });

    it('rejects editing the subject directly on Enviados_2', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/me/sequence-steps/${step2Id}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ subject: 'Intento directo' });
      expect(response.status).toBe(400);
    });

    it('editing Enviados_1 subject cascades to Enviados_2/3', async () => {
      const update = await request(app.getHttpServer())
        .patch(`/me/sequence-steps/${step1Id}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ subject: '{nombre_contacto}, una propuesta para {empresa}', htmlBody: '<p>Hola</p>' });
      expect(update.status).toBe(200);
      expect(update.body.subject).toBe('{nombre_contacto}, una propuesta para {empresa}');

      const steps = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/steps`)
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(steps.body[1].subject).toBe('{nombre_contacto}, una propuesta para {empresa}');
      expect(steps.body[2].subject).toBe('{nombre_contacto}, una propuesta para {empresa}');
    });
  });

  describe('§5 — optional per-step header + §7 — schedule preview', () => {
    let sequenceId: string;
    let stepIds: string[];

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/me/sequences/wizard')
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ clientId, mailboxId, managementDate: '2026-07-24' });
      sequenceId = created.body.id;
      const steps = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/steps`)
        .set('Authorization', `Bearer ${executiveToken}`);
      stepIds = steps.body.map((s: { id: string }) => s.id);
    });

    it('is independent per step and included in the step preview as its own field', async () => {
      const update = await request(app.getHttpServer())
        .patch(`/me/sequence-steps/${stepIds[0]}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ htmlHeader: '<p>{empresa} — encabezado</p>', htmlBody: '<p>Cuerpo</p>' });
      expect(update.status).toBe(200);
      expect(update.body.htmlHeader).toBe('<p>{empresa} — encabezado</p>');

      // Untouched sibling steps keep no header — it is NOT auto-replicated unless the wizard does it client-side.
      const step2 = await request(app.getHttpServer())
        .get(`/me/sequence-steps/${stepIds[1]}`)
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(step2.body.htmlHeader).toBeNull();

      const preview = await request(app.getHttpServer())
        .get(`/me/sequence-steps/${stepIds[0]}/preview`)
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(preview.status).toBe(200);
      expect(preview.body.htmlHeader).toBe('<p>{empresa} — encabezado</p>');
      expect(preview.body.renderedHeader).toEqual(expect.any(String));
      expect(preview.body.renderedHeader).not.toContain('{empresa}');
    });

    it('the publish contract carries headerHtml per step', async () => {
      for (const stepId of stepIds) {
        await request(app.getHttpServer())
          .patch(`/me/sequence-steps/${stepId}`)
          .set('Authorization', `Bearer ${executiveToken}`)
          .send({ htmlBody: '<p>Contenido</p>' });
      }
      await request(app.getHttpServer())
        .post(`/me/sequences/${sequenceId}/publish`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .set('Idempotency-Key', `wizard-header-publish-${sequenceId}`)
        .send({});

      const commandView = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/publish/command`)
        .set('Authorization', `Bearer ${executiveToken}`);
      const firstStepPayload = commandView.body.command.payload.steps[0];
      expect(firstStepPayload).toHaveProperty('headerHtml');
      expect(firstStepPayload.headerHtml).toBe('<p>{empresa} — encabezado</p>');
      expect(firstStepPayload).not.toHaveProperty('attachments');
    });

    it('computes a live schedule preview with an estimated date per step, chained off the previous one', async () => {
      const preview = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/schedule-preview`)
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(preview.status).toBe(200);
      expect(preview.body.effectiveStartAt).toEqual(expect.any(String));
      expect(preview.body.steps).toHaveLength(3);
      const [step1, step2, step3] = preview.body.steps;
      expect(new Date(step1.estimatedAt).getTime()).toBe(new Date(preview.body.effectiveStartAt).getTime());
      expect(new Date(step2.estimatedAt).getTime()).toBeGreaterThan(new Date(step1.estimatedAt).getTime());
      expect(new Date(step3.estimatedAt).getTime()).toBeGreaterThan(new Date(step2.estimatedAt).getTime());
    });

    it('recalculates the preview when the sending window or a step delay changes', async () => {
      const before = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/schedule-preview`)
        .set('Authorization', `Bearer ${executiveToken}`);

      await request(app.getHttpServer())
        .patch(`/me/sequences/${sequenceId}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ schedule: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], windows: [{ start: '10:00', end: '17:00' }] } });
      await request(app.getHttpServer())
        .patch(`/me/sequence-steps/${stepIds[1]}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ delayValue: 3, delayUnit: 'BUSINESS_DAYS' });

      const after = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/schedule-preview`)
        .set('Authorization', `Bearer ${executiveToken}`);
      expect(after.body.steps[1].estimatedAt).not.toBe(before.body.steps[1].estimatedAt);
    });
  });

  describe('§7 — .xlsx import', () => {
    let sequenceId: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/me/sequences/wizard')
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ clientId, mailboxId, managementDate: '2026-07-22' });
      sequenceId = created.body.id;
    });

    it('parses a real .xlsx file (headers, row count, preview) via the wizard import step', async () => {
      const buffer = await buildXlsxBuffer(
        ['Empresa', 'Nombre', 'Email'],
        [
          ['Café Andina', 'Marcela Rojas', `marcela.${stamp}@example.com`],
          ['Café Andina', 'Tomás Vidal', `tomas.${stamp}@example.com`],
        ],
      );

      const upload = await request(app.getHttpServer())
        .post(`/me/sequences/${sequenceId}/imports`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .attach('file', buffer, 'contactos.xlsx');

      expect(upload.status).toBe(201);
      expect(upload.body.headers).toEqual(['Empresa', 'Nombre', 'Email']);
      expect(upload.body.import.totalRows).toBe(2);
      expect(upload.body.previewRows).toHaveLength(2);
      expect(upload.body.previewRows[0]).toEqual(
        expect.objectContaining({ Empresa: 'Café Andina', Nombre: 'Marcela Rojas' }),
      );

      const mapping = await request(app.getHttpServer())
        .post(`/me/sequence-imports/${upload.body.import.id}/mapping`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ email: 'Email', firstName: 'Nombre', company: 'Empresa' });
      expect(mapping.status).toBe(201);
      expect(mapping.body.status).toBe('READY');
      expect(mapping.body.validRows).toBe(2);
      expect(mapping.body.invalidRows).toBe(0);
    });

    it('rejects a file that is neither .xlsx nor .csv', async () => {
      const response = await request(app.getHttpServer())
        .post(`/me/sequences/${sequenceId}/imports`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .attach('file', Buffer.from('not a spreadsheet'), 'contactos.txt');
      expect(response.status).toBe(400);
    });
  });

  describe('publish contract + effective start + FAILED/retry', () => {
    let sequenceId: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/me/sequences/wizard')
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ clientId, mailboxId, managementDate: '2026-07-20' });
      sequenceId = created.body.id;
      const steps = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/steps`)
        .set('Authorization', `Bearer ${executiveToken}`);
      await request(app.getHttpServer())
        .patch(`/me/sequence-steps/${steps.body[0].id}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ subject: 'Hola {nombre_contacto}', htmlBody: '<p>Hola</p>' });
      for (const step of steps.body) {
        await request(app.getHttpServer())
          .patch(`/me/sequence-steps/${step.id}`)
          .set('Authorization', `Bearer ${executiveToken}`)
          .send({ htmlBody: '<p>Contenido</p>' });
      }
    });

    it('a FAILED scenario does not bump sequenceVersion, and a plain retry then succeeds without duplicating', async () => {
      const failed = await request(app.getHttpServer())
        .post(`/me/sequences/${sequenceId}/publish`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .set('Idempotency-Key', `wizard-publish-failed-${sequenceId}`)
        .send({ scenario: 'FAILED' });
      expect(failed.status).toBe(201);
      expect(failed.body.sequence.publishStatus).toBe('FAILED');
      expect(failed.body.sequence.sequenceVersion).toBe(0);
      expect(failed.body.sequence.lastPublishedAt).toBeNull();

      const retried = await request(app.getHttpServer())
        .post(`/me/sequences/${sequenceId}/publish`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .set('Idempotency-Key', `wizard-publish-retry-${sequenceId}`)
        .send({});
      expect(retried.status).toBe(201);
      expect(retried.body.sequence.publishStatus).toBe('ACTIVE');
      expect(retried.body.sequence.sequenceVersion).toBe(1);
      expect(retried.body.sequence.lastPublishedAt).not.toBeNull();
      expect(retried.body.sequence.effectiveStartAt).not.toBeNull();

      // Spec §8 — the engine's own reported outcome (failed AND completed) must be audited.
      const auditLog = await request(app.getHttpServer())
        .get(`/users/${executiveId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      const actions = auditLog.body.map((entry: { action: string }) => entry.action);
      expect(actions).toContain('sequence.publish_failed');
      expect(actions).toContain('sequence.publish_completed');
    });

    it('the publish command payload matches the §22 contract shape', async () => {
      const commandView = await request(app.getHttpServer())
        .get(`/me/sequences/${sequenceId}/publish/command`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(commandView.status).toBe(200);
      const { payload } = commandView.body.command;
      expect(payload.displayName).toBe('Gestión_20072026');
      expect(payload.timezone).toBe('America/Santiago');
      expect(payload.startPolicy.effectiveStartAt).toEqual(expect.any(String));
      expect(payload.sendingWindow).toEqual(
        expect.objectContaining({ startTime: '08:00', endTime: '19:00', timezone: 'America/Santiago' }),
      );
      expect(payload.steps.map((s: { stepCode: string }) => s.stepCode)).toEqual([
        'Enviados_1',
        'Enviados_2',
        'Enviados_3',
      ]);
      expect(payload.steps[0].trigger).toEqual({ type: 'SEQUENCE_START' });
      expect(payload.steps[1].trigger).toEqual({
        type: 'AFTER_STEP_SENT',
        afterStepCode: 'Enviados_1',
        delay: { value: 5, unit: 'BUSINESS_DAYS' },
      });
      expect(payload.steps[1].subjectSourceStepCode).toBe('Enviados_1');
      expect(payload.steps[1].subjectTemplate).toBeNull();
    });
  });
});
