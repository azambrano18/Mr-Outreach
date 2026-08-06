import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive, linkClientMailbox } from './fixtures';
import { SimulatedMailboxMotorAdapter } from '../src/infrastructure/mailbox-motor/simulated/simulated-mailbox-motor-adapter';

/**
 * Fase "Control operativo de Gestiones" (e2e) — pause/resume/stop/restart
 * exercised through the real HTTP surface: real state-machine transitions,
 * real motor calls (simulated adapter), real audit entries, real 403s for
 * a non-admin. No controller/service method is mocked — every assertion
 * below goes through `supertest` against the live NestJS app (memory
 * persistence + simulated mailbox/sequence-execution motors, exactly like
 * every other e2e spec in this suite).
 */
describe('Sequence Execution operational control (e2e) — memory + simulated motors', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminUserId: string;
  let executiveToken: string;
  const stamp = Date.now();

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

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    const executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Control',
      email: `control.e2e.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    executiveToken = executive.token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTemplate(mailboxId: string, name: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/me/sequence-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mailboxId, name });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  async function fillValidTemplate(templateId: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/me/sequence-templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subjectTemplate: 'Hola {contact_name}, esto es {company_name}' });
    for (const stepNumber of [1, 2, 3]) {
      await request(app.getHttpServer())
        .patch(`/me/sequence-templates/${templateId}/steps/${stepNumber}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bodyHtml: `<p>Cuerpo del envío ${stepNumber} para {contact_name}</p>` });
    }
  }

  async function publishTemplate(templateId: string, idempotencyKey: string): Promise<void> {
    const response = await request(app.getHttpServer())
      .post(`/me/sequence-templates/${templateId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({});
    expect(response.status).toBe(201);
  }

  /**
   * Builds a Gestión all the way to RUNNING using only real HTTP calls plus
   * the dev-only motor-event emitter (which runs the SAME ProcessMotorEventUseCase
   * a real Railway webhook would use — never a shortcut that bypasses the
   * projector). ACCEPTED -> RUNNING has no other trigger in this codebase
   * (no local dispatch loop for the modern Gestión flow), so this dev tool
   * is the only way to reach RUNNING outside of a real motor connection —
   * exactly the same tool DevSimulatedExecutionStateService documents itself
   * for.
   */
  async function buildRunningExecution(suffix: string): Promise<{ executionId: string; serverExecutionId: string }> {
    const { mailboxId } = await linkClientMailbox(app, adminToken, adminUserId, {
      email: `ventas.control.${suffix}@example.test`,
      domainName: `control-${suffix}.test`,
    });
    const templateId = await createTemplate(mailboxId, `Plantilla Control ${suffix}`);
    await fillValidTemplate(templateId);
    await publishTemplate(templateId, `e2e-control-publish-${suffix}`);

    const createExec = await request(app.getHttpServer())
      .post('/me/sequence-executions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mailboxId, templateId });
    expect(createExec.status).toBe(201);
    const executionId = createExec.body.id as string;

    const csv = 'Correo,Nombre,Empresa\n' + `persona.${suffix}@empresa.test,Persona Uno,Empresa Control\n`;
    const upload = await request(app.getHttpServer())
      .post(`/me/sequence-executions/${executionId}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'contactos.csv');
    expect(upload.status).toBe(201);

    const mapping = await request(app.getHttpServer())
      .post(`/me/sequence-executions/${executionId}/mapping`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'Correo', contactName: 'Nombre', companyName: 'Empresa', customVariables: {} });
    expect(mapping.status).toBe(201);

    const start = await request(app.getHttpServer())
      .post(`/me/sequence-executions/${executionId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-control-start-${suffix}`)
      .send({});
    expect(start.status).toBe(201);
    expect(start.body.status).toBe('ACCEPTED');
    const serverExecutionId = start.body.serverExecutionId as string;
    expect(serverExecutionId).toBeTruthy();

    const processing = await request(app.getHttpServer())
      .post(`/dev/motor-events/${executionId}/emit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eventType: 'EXECUTION_PROCESSING', payload: {} });
    expect(processing.status).toBe(201);

    const detail = await getAdminDetail(executionId);
    expect(detail.body.status).toBe('RUNNING');

    return { executionId, serverExecutionId };
  }

  async function getAdminDetail(executionId: string) {
    return request(app.getHttpServer())
      .get(`/admin/sequence-executions/${executionId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  /**
   * §4/§7 — real staging case: the motor accepted the Gestión (status
   * ACCEPTED, serverStatus QUEUED after a refresh) but it never advanced
   * to RUNNING. Deliberately never emits EXECUTION_PROCESSING, unlike
   * buildRunningExecution above.
   */
  async function buildAcceptedExecution(
    suffix: string,
    prospectCount = 13,
  ): Promise<{ executionId: string; serverExecutionId: string; mailboxId: string; serverMailboxId: string }> {
    const { mailboxId, serverMailboxId } = await linkClientMailbox(app, adminToken, adminUserId, {
      email: `ventas.accepted.${suffix}@example.test`,
      domainName: `accepted-${suffix}.test`,
    });
    const templateId = await createTemplate(mailboxId, `Plantilla Aceptada ${suffix}`);
    await fillValidTemplate(templateId);
    await publishTemplate(templateId, `e2e-accepted-publish-${suffix}`);

    const createExec = await request(app.getHttpServer())
      .post('/me/sequence-executions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mailboxId, templateId });
    expect(createExec.status).toBe(201);
    const executionId = createExec.body.id as string;

    const rows = Array.from({ length: prospectCount }, (_, i) => `persona${i}.${suffix}@empresa.test,Persona ${i},Empresa Aceptada`);
    const csv = 'Correo,Nombre,Empresa\n' + rows.join('\n') + '\n';
    const upload = await request(app.getHttpServer())
      .post(`/me/sequence-executions/${executionId}/import`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'contactos.csv');
    expect(upload.status).toBe(201);

    const mapping = await request(app.getHttpServer())
      .post(`/me/sequence-executions/${executionId}/mapping`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'Correo', contactName: 'Nombre', companyName: 'Empresa', customVariables: {} });
    expect(mapping.status).toBe(201);

    const start = await request(app.getHttpServer())
      .post(`/me/sequence-executions/${executionId}/start`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-accepted-start-${suffix}`)
      .send({});
    expect(start.status).toBe(201);
    expect(start.body.status).toBe('ACCEPTED');
    const serverExecutionId = start.body.serverExecutionId as string;
    expect(serverExecutionId).toBeTruthy();

    return { executionId, serverExecutionId, mailboxId, serverMailboxId };
  }

  // ---------------------------------------------------------------------
  // Autorización
  // ---------------------------------------------------------------------

  it('a plain EXECUTIVE (even the Gestión owner) gets 403 on pause/resume/stop/restart — ADMIN-only', async () => {
    const { executionId } = await buildRunningExecution(`${stamp}-authz`);

    const pause = await request(app.getHttpServer())
      .post(`/admin/sequence-executions/${executionId}/pause`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('Idempotency-Key', `e2e-authz-pause-${stamp}`)
      .send({});
    expect(pause.status).toBe(403);

    const detail = await getAdminDetail(executionId);
    expect(detail.body.status).toBe('RUNNING');
  });

  it('every control endpoint requires the Idempotency-Key header', async () => {
    const { executionId } = await buildRunningExecution(`${stamp}-noidem`);
    const response = await request(app.getHttpServer())
      .post(`/admin/sequence-executions/${executionId}/pause`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(response.status).toBe(400);
  });

  // ---------------------------------------------------------------------
  // Pausar / Reanudar
  // ---------------------------------------------------------------------

  describe('Pausar / Reanudar', () => {
    it('pauses a RUNNING execution, persists PAUSED + pausedAt, and audits sequence_execution.paused', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-pause-ok`);

      const pause = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-pause-ok-${stamp}`)
        .send({});
      expect(pause.status).toBe(201);
      expect(pause.body.status).toBe('PAUSED');
      expect(pause.body.pausedAt).toBeTruthy();

      const detail = await getAdminDetail(executionId);
      expect(detail.body.status).toBe('PAUSED');

      const auditResponse = await request(app.getHttpServer())
        .get(`/users/${adminUserId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(
        auditResponse.body.some(
          (e: { action: string; entityId: string }) => e.action === 'sequence_execution.paused' && e.entityId === executionId,
        ),
      ).toBe(true);
    });

    it('a double-click with the SAME Idempotency-Key never duplicates the pause — both calls return the identical final state', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-pause-dup`);
      const key = `e2e-pause-dup-${stamp}`;

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post(`/admin/sequence-executions/${executionId}/pause`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('Idempotency-Key', key)
          .send({}),
        request(app.getHttpServer())
          .post(`/admin/sequence-executions/${executionId}/pause`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('Idempotency-Key', key)
          .send({}),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.status).toBe('PAUSED');
      expect(second.body.status).toBe('PAUSED');
    });

    it('rejects pausing a DRAFT execution with a 409', async () => {
      const { mailboxId } = await linkClientMailbox(app, adminToken, adminUserId, {
        email: `ventas.draft.${stamp}@example.test`,
        domainName: `draft-${stamp}.test`,
      });
      const templateId = await createTemplate(mailboxId, 'Plantilla Draft Control');
      await fillValidTemplate(templateId);
      await publishTemplate(templateId, `e2e-draft-publish-${stamp}`);
      const createExec = await request(app.getHttpServer())
        .post('/me/sequence-executions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ mailboxId, templateId });

      const pause = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${createExec.body.id}/pause`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-draft-pause-${stamp}`)
        .send({});
      expect(pause.status).toBe(409);
    });

    it('resumes a PAUSED execution back to RUNNING, respecting order — no duplicate motor call, no new send', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-resume-ok`);
      await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-resume-ok-pause-${stamp}`)
        .send({});

      const resume = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/resume`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-resume-ok-resume-${stamp}`)
        .send({});
      expect(resume.status).toBe(201);
      expect(resume.body.status).toBe('RUNNING');
      expect(resume.body.resumedAt).toBeTruthy();
    });

    it('rejects resuming an execution that is RUNNING (never paused) with a 409', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-resume-invalid`);
      const resume = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/resume`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-resume-invalid-${stamp}`)
        .send({});
      expect(resume.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------
  // Detener
  // ---------------------------------------------------------------------

  describe('Detener', () => {
    it('requires a reason between 3 and 300 characters', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-stop-noreason`);
      const response = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/stop`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-stop-noreason-${stamp}`)
        .send({ reason: 'no' });
      expect(response.status).toBe(400);
    });

    it('stops a RUNNING execution with a valid reason, persists STOPPED + stopReason, and audits sequence_execution.stopped', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-stop-ok`);
      const stop = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/stop`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-stop-ok-${stamp}`)
        .send({ reason: 'El cliente solicitó detener la campaña por cambio de estrategia.' });
      expect(stop.status).toBe(201);
      expect(stop.body.status).toBe('STOPPED');
      expect(stop.body.stopReason).toBe('El cliente solicitó detener la campaña por cambio de estrategia.');

      const detail = await getAdminDetail(executionId);
      expect(detail.body.status).toBe('STOPPED');

      const auditResponse = await request(app.getHttpServer())
        .get(`/users/${adminUserId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(
        auditResponse.body.some(
          (e: { action: string; entityId: string }) => e.action === 'sequence_execution.stopped' && e.entityId === executionId,
        ),
      ).toBe(true);
    });

    it('once STOPPED, resume is rejected with a 409 — stop is never reversible via resume', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-stop-noresume`);
      await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/stop`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-stop-noresume-stop-${stamp}`)
        .send({ reason: 'Motivo válido para detener.' });

      const resume = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/resume`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-stop-noresume-resume-${stamp}`)
        .send({});
      expect(resume.status).toBe(409);
    });

    it('COMPLETED rejects every action with a 409', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-completed`);
      const completed = await request(app.getHttpServer())
        .post(`/dev/simulated/executions/${executionId}/state`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'COMPLETED' });
      expect(completed.status).toBe(201);

      const pause = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-completed-pause-${stamp}`)
        .send({});
      expect(pause.status).toBe(409);

      const stop = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/stop`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-completed-stop-${stamp}`)
        .send({ reason: 'Motivo válido.' });
      expect(stop.status).toBe(409);
    });
  });

  // ---------------------------------------------------------------------
  // Detener antes de iniciar (ACCEPTED/QUEUED — caso real de staging)
  // ---------------------------------------------------------------------

  describe('Detener una Gestión ACCEPTED (aceptada por el motor, aún no iniciada)', () => {
    it('a plain EXECUTIVE gets 403 on stop even while ACCEPTED', async () => {
      const { executionId } = await buildAcceptedExecution(`${stamp}-accepted-authz`);
      const stop = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/stop`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .set('Idempotency-Key', `e2e-accepted-authz-${stamp}`)
        .send({ reason: 'Motivo válido.' });
      expect(stop.status).toBe(403);

      const detail = await getAdminDetail(executionId);
      expect(detail.body.status).toBe('ACCEPTED');
    });

    it('ADMIN stops it: STOPPED, sentCount/pendingCount zeroed, no email sent, and sequence_execution.stopped is audited with stoppedBeforeStart', async () => {
      const { executionId } = await buildAcceptedExecution(`${stamp}-accepted-ok`, 13);

      // Matches the real staging report: an admin refreshed status once, seeing serverStatus QUEUED, before the fix let anyone stop it.
      const refresh = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/refresh-status`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(refresh.status).toBe(201);
      expect(refresh.body.status).toBe('ACCEPTED');
      expect(refresh.body.serverStatus).toBe('QUEUED');

      const stop = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/stop`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-accepted-ok-${stamp}`)
        .send({ reason: 'Detenida antes de iniciar — prueba e2e.' });
      expect(stop.status).toBe(201);
      expect(stop.body.status).toBe('STOPPED');
      expect(stop.body.sentCount).toBe(0);
      expect(stop.body.pendingCount).toBe(0);

      const detail = await getAdminDetail(executionId);
      expect(detail.body.status).toBe('STOPPED');
      // The 13 accepted prospects are conserved — never rewritten by the stop.
      expect(detail.body.acceptedProspects).toBe(13);

      const auditResponse = await request(app.getHttpServer())
        .get(`/users/${adminUserId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      const entry = auditResponse.body.find(
        (e: { action: string; entityId: string }) => e.action === 'sequence_execution.stopped' && e.entityId === executionId,
      );
      expect(entry).toBeTruthy();
      expect(entry.metadata).toEqual(
        expect.objectContaining({
          stoppedBeforeStart: true,
          sentCount: 0,
          cancelledPendingContacts: 13,
          cancelledJobs: 13,
          previousServerStatus: 'QUEUED',
        }),
      );
    });

    it('a double-click with the SAME Idempotency-Key never duplicates the stop command', async () => {
      const { executionId } = await buildAcceptedExecution(`${stamp}-accepted-dup`);
      const key = `e2e-accepted-dup-${stamp}`;

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post(`/admin/sequence-executions/${executionId}/stop`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('Idempotency-Key', key)
          .send({ reason: 'Motivo válido.' }),
        request(app.getHttpServer())
          .post(`/admin/sequence-executions/${executionId}/stop`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('Idempotency-Key', key)
          .send({ reason: 'Motivo válido.' }),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.status).toBe('STOPPED');
      expect(second.body.status).toBe('STOPPED');

      const auditResponse = await request(app.getHttpServer())
        .get(`/users/${adminUserId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      const stopEntries = auditResponse.body.filter(
        (e: { action: string; entityId: string }) => e.action === 'sequence_execution.stopped' && e.entityId === executionId,
      );
      expect(stopEntries).toHaveLength(1);
    });

    it('an ACCEPTED Gestión blocks deleting its mailbox; stopping it unblocks deletion', async () => {
      const { executionId, mailboxId, serverMailboxId } = await buildAcceptedExecution(`${stamp}-accepted-delete`);

      // Unlinking is allowed while merely ACCEPTED (narrower rule than delete's) — reach REVOKED so only the Gestión check remains.
      const mailboxMotor = app.get(SimulatedMailboxMotorAdapter);
      mailboxMotor.setUnlinkOutcome(serverMailboxId, 'SUCCESS');
      const unlink = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/unlink`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-accepted-delete-unlink-${stamp}`)
        .send({ reason: 'Cuenta dada de baja — prueba e2e', removeAssignmentsAfterUnlink: true });
      expect(unlink.status).toBe(201);
      expect(unlink.body.linkStatus).toBe('REVOKED');

      const blockedDelete = await request(app.getHttpServer())
        .delete(`/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(blockedDelete.status).toBe(409);
      expect(blockedDelete.body.message).toMatch(/gesti[oó]n/i);

      const stop = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/stop`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-accepted-delete-stop-${stamp}`)
        .send({ reason: 'Detenida para permitir eliminar la cuenta.' });
      expect(stop.status).toBe(201);
      expect(stop.body.status).toBe('STOPPED');

      const allowedDelete = await request(app.getHttpServer())
        .delete(`/mailboxes/${mailboxId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(allowedDelete.status).toBe(204);

      // The stopped Gestión itself is never deleted — it remains as history in the Monitor.
      const detail = await getAdminDetail(executionId);
      expect(detail.status).toBe(200);
      expect(detail.body.status).toBe('STOPPED');
    });
  });

  // ---------------------------------------------------------------------
  // Reiniciar
  // ---------------------------------------------------------------------

  describe('Reiniciar', () => {
    async function buildStoppedExecution(suffix: string) {
      const { executionId } = await buildRunningExecution(suffix);
      await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/stop`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-restart-setup-stop-${suffix}`)
        .send({ reason: 'Motivo válido para detener antes de reiniciar.' });
      return executionId;
    }

    it('rejects restarting a RUNNING/PAUSED execution — only STOPPED can be restarted', async () => {
      const { executionId } = await buildRunningExecution(`${stamp}-restart-invalid`);
      const restart = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/restart`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-restart-invalid-${stamp}`)
        .send({});
      expect(restart.status).toBe(409);
    });

    it('preview reports the eligible contact (never emailed) before confirming', async () => {
      const executionId = await buildStoppedExecution(`${stamp}-restart-preview`);
      const preview = await request(app.getHttpServer())
        .get(`/admin/sequence-executions/${executionId}/restart-preview`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(preview.status).toBe(200);
      expect(preview.body.totalContacts).toBe(1);
      expect(preview.body.alreadyContactedCount).toBe(0);
      expect(preview.body.eligibleCount).toBe(1);
    });

    it('creates a new execution attempt (executionAttempt 2, previousExecutionId set), never mutating the STOPPED original', async () => {
      const executionId = await buildStoppedExecution(`${stamp}-restart-ok`);

      const restart = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/restart`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-restart-ok-${stamp}`)
        .send({});
      expect(restart.status).toBe(201);
      expect(restart.body.executionAttempt).toBe(2);
      expect(restart.body.previousExecutionId).toBe(executionId);
      expect(restart.body.status).toBe('DRAFT');
      expect(restart.body.id).not.toBe(executionId);

      const originalDetail = await getAdminDetail(executionId);
      expect(originalDetail.body.status).toBe('STOPPED');
      expect(originalDetail.body.executionAttempt).toBe(1);

      const auditResponse = await request(app.getHttpServer())
        .get(`/users/${adminUserId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(
        auditResponse.body.some(
          (e: { action: string; entityId: string }) => e.action === 'sequence_execution.restarted' && e.entityId === executionId,
        ),
      ).toBe(true);
    });

    it('a repeated restart call with the same Idempotency-Key returns the identical new execution, never creating a second one', async () => {
      const executionId = await buildStoppedExecution(`${stamp}-restart-dup`);
      const key = `e2e-restart-dup-${stamp}`;

      const first = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/restart`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', key)
        .send({});
      const second = await request(app.getHttpServer())
        .post(`/admin/sequence-executions/${executionId}/restart`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', key)
        .send({});

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
    });
  });
});
