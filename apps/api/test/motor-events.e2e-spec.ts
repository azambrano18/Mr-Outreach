import { INestApplication } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { CompanyRepository } from '../src/domain/company/company.repository';
import { ConversationReadStateRepository } from '../src/domain/conversation/conversation-read-state.repository';
import { ContactRepository } from '../src/domain/contact/contact.repository';
import { ProspectImportRowRepository } from '../src/domain/prospect-import/prospect-import-row.repository';
import { SequenceExecutionRepository } from '../src/domain/sequence-execution/sequence-execution.repository';
import {
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  CONVERSATION_READ_STATE_REPOSITORY,
  PROSPECT_IMPORT_ROW_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
} from '../src/infrastructure/persistence/tokens';
import { MOTOR_EVENT_SCHEMA_VERSION } from '../src/modules/integration/dto/motor-event-envelope.dto';
import { createTestApp } from './create-test-app';
import { createReadyExecutive, linkClientMailbox } from './fixtures';

/**
 * Fase 16 — HTTP-level evidence for `POST /integration/events`: the
 * authentication guard, idempotent reception, projection into
 * conversations/messages visible through the executive's own read APIs,
 * and the admin-only retry endpoint's permission gating. Runs against the
 * memory driver + a real HMAC secret from .env.test — no Postgres needed
 * (that evidence lives in motor-event-ingestion.integration.spec.ts).
 *
 * Per-user unread independence is asserted against
 * ConversationReadStateRepository directly rather than the
 * ConversationSummary.isUnread field: that field is still the pre-existing
 * coarse/global flag (flipped by ANY user's "open" call, inherited from
 * the legacy IMAP-sync flow) — the per-user source of truth this phase
 * relies on is ConversationReadState, not that flag. See Fase 20's report
 * for this known limitation.
 */
describe('Motor event ingestion (e2e) — memory + HMAC', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminUserId: string;
  let executiveToken: string;
  let executiveId: string;
  let otherExecutiveToken: string;
  let organizationId: string;
  let mailboxId: string;
  let clientId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const hmacSecret = process.env.MOTOR_EVENT_HMAC_SECRET as string;

  function sign(timestamp: string, rawBody: string): string {
    return createHmac('sha256', hmacSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  }

  async function postEvent(body: unknown, options: { signed?: boolean; badSignature?: boolean; timestamp?: string } = {}) {
    const raw = JSON.stringify(body);
    const req = request(app.getHttpServer()).post('/integration/events').set('Content-Type', 'application/json');
    if (options.signed === false) {
      return req.send(raw);
    }
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
    const signature = options.badSignature ? 'deadbeef'.repeat(8) : sign(timestamp, raw);
    return req.set('X-Motor-Timestamp', timestamp).set('X-Motor-Signature', signature).send(raw);
  }

  function envelope(overrides: Record<string, unknown> & { eventType: string; payload: Record<string, unknown> }) {
    return {
      schemaVersion: MOTOR_EVENT_SCHEMA_VERSION,
      eventId: `evt_${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      organizationId,
      commandId: null,
      correlationId: `corr_${randomUUID()}`,
      aggregateType: 'EXECUTION',
      ...overrides,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();

    const adminLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    adminUserId = me.body.id;
    organizationId = me.body.organizationId;

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    const executiveRoleId = roles.body.find((r: { name: string }) => r.name === 'EXECUTIVE').id;

    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Motor Event',
      email: `motor-event-exec-${Date.now()}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    executiveId = executive.id;
    executiveToken = executive.token;

    const otherExecutive = await createReadyExecutive(app, adminToken, {
      name: 'Otra Ejecutiva',
      email: `motor-event-other-${Date.now()}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    otherExecutiveToken = otherExecutive.token;

    const linked = await linkClientMailbox(app, adminToken, executiveId, { clientName: 'Cliente Motor Event E2E' });
    mailboxId = linked.mailboxId;
    clientId = linked.clientId;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Seeds a resolved Gestión (SequenceExecution + ProspectImportRow + Company/Contact) directly through the in-memory repos — no Plantillas/Gestiones HTTP wizard exists yet to drive this end to end. */
  async function seedGestion() {
    const executions = app.get<SequenceExecutionRepository>(SEQUENCE_EXECUTION_REPOSITORY);
    const rows = app.get<ProspectImportRowRepository>(PROSPECT_IMPORT_ROW_REPOSITORY);
    const companies = app.get<CompanyRepository>(COMPANY_REPOSITORY);
    const contacts = app.get<ContactRepository>(CONTACT_REPOSITORY);

    const execution = await executions.create({
      organizationId,
      executiveId,
      mailboxId,
      templateId: `tpl_${randomUUID()}`,
      templateVersionId: `tplv_${randomUUID()}`,
      timezone: 'America/Santiago',
      createdBy: executiveId,
    });
    await executions.update(execution.id, { status: 'SUBMITTING' });

    const company = await companies.create({ organizationId, clientId, rawName: `Empresa E2E ${randomUUID().slice(0, 6)}` });
    const email = `prospecto-${randomUUID().slice(0, 8)}@empresa-e2e.test`;
    const contact = await contacts.create({ organizationId, clientId, companyId: company.id, email, fullName: 'Prospecto E2E' });
    const [row] = await rows.createMany([
      {
        organizationId,
        importId: `imp_${randomUUID()}`,
        rowNumber: 1,
        rawData: { email },
        normalizedData: { email, contactName: 'Prospecto E2E', companyName: company.rawName, variables: {} },
        validationStatus: 'VALID',
      },
    ]);
    await rows.bulkSetResolvedIdentity([{ rowId: row.id, companyId: company.id, contactId: contact.id }], new Date());

    return { executionId: execution.id, rowId: row.id, contactEmail: email, companyId: company.id, contactId: contact.id };
  }

  it('rejects a request with no signature at all', async () => {
    const response = await postEvent(envelope({ eventType: 'EXECUTION_PROCESSING', aggregateId: 'exec_x', payload: {} }), { signed: false });
    expect(response.status).toBe(401);
  });

  it('rejects a request with an invalid signature', async () => {
    const response = await postEvent(envelope({ eventType: 'EXECUTION_PROCESSING', aggregateId: 'exec_x', payload: {} }), { badSignature: true });
    expect(response.status).toBe(401);
  });

  it('rejects an expired timestamp outside the configured clock-skew tolerance', async () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const response = await postEvent(envelope({ eventType: 'EXECUTION_PROCESSING', aggregateId: 'exec_x', payload: {} }), { timestamp: staleTimestamp });
    expect(response.status).toBe(401);
  });

  it('rejects a malformed event (unknown eventType) with 400 and never leaks a stack trace', async () => {
    const response = await postEvent(envelope({ eventType: 'NOT_A_REAL_EVENT_TYPE', aggregateId: 'exec_x', payload: {} }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  it('accepts a validly signed event, projects it, and makes it visible to the assigned executive via /me/conversations', async () => {
    const { executionId, rowId, contactEmail, companyId: seededCompanyId, contactId: seededContactId } = await seedGestion();
    const outboundMessageId = `out_${randomUUID()}`;

    const accepted = await postEvent(
      envelope({ eventType: 'EXECUTION_ACCEPTED', aggregateId: executionId, payload: { serverExecutionId: `srv_${randomUUID()}` } }),
    );
    expect(accepted.status).toBe(200);

    const createdEnvelope = envelope({
      eventType: 'OUTBOUND_MESSAGE_CREATED',
      aggregateId: executionId,
      payload: {
        outboundMessageId,
        mailboxId,
        prospectImportRowId: rowId,
        recipientEmail: contactEmail,
        subject: 'Hola',
        htmlBody: '<p>Hola</p>',
        plainTextBody: 'Hola',
        stepNumber: 1,
      },
    });
    const created = await postEvent(createdEnvelope);
    expect(created.status).toBe(200);

    // The exact same eventId redelivered — must be accepted idempotently, never duplicated.
    const createdAgain = await postEvent(createdEnvelope);
    expect([200, 202]).toContain(createdAgain.status);

    const list = await request(app.getHttpServer()).get('/me/conversations').set('Authorization', `Bearer ${executiveToken}`);
    expect(list.status).toBe(200);
    const conversation = list.body.find((c: { contactEmail: string }) => c.contactEmail === contactEmail);
    expect(conversation).toBeDefined();
    expect(conversation.contactId).toBe(seededContactId);
    expect(conversation.companyId).toBe(seededCompanyId);

    const detail = await request(app.getHttpServer())
      .get(`/me/conversations/${conversation.id}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.messages).toHaveLength(1);
    expect(detail.body.messages[0].direction).toBe('OUTBOUND');
  });

  it('never shows a Gestión\'s conversation to an executive who is not assigned to that mailbox', async () => {
    const { executionId, rowId, contactEmail } = await seedGestion();
    await postEvent(envelope({ eventType: 'EXECUTION_ACCEPTED', aggregateId: executionId, payload: { serverExecutionId: `srv_${randomUUID()}` } }));
    await postEvent(
      envelope({
        eventType: 'OUTBOUND_MESSAGE_CREATED',
        aggregateId: executionId,
        payload: {
          outboundMessageId: `out_${randomUUID()}`,
          mailboxId,
          prospectImportRowId: rowId,
          recipientEmail: contactEmail,
          subject: 'Hola',
          htmlBody: '<p>Hola</p>',
          plainTextBody: 'Hola',
        },
      }),
    );

    const list = await request(app.getHttpServer()).get('/me/conversations').set('Authorization', `Bearer ${otherExecutiveToken}`);
    expect(list.body.find((c: { contactEmail: string }) => c.contactEmail === contactEmail)).toBeUndefined();
  });

  it('records an independent ConversationReadState per user — an admin opening a conversation never marks it read for the assigned executive', async () => {
    const { executionId, rowId, contactEmail } = await seedGestion();
    await postEvent(envelope({ eventType: 'EXECUTION_ACCEPTED', aggregateId: executionId, payload: { serverExecutionId: `srv_${randomUUID()}` } }));
    await postEvent(
      envelope({
        eventType: 'OUTBOUND_MESSAGE_CREATED',
        aggregateId: executionId,
        payload: {
          outboundMessageId: `out_${randomUUID()}`,
          mailboxId,
          prospectImportRowId: rowId,
          recipientEmail: contactEmail,
          subject: 'Hola',
          htmlBody: '<p>Hola</p>',
          plainTextBody: 'Hola',
        },
      }),
    );

    const list = await request(app.getHttpServer()).get('/me/conversations').set('Authorization', `Bearer ${executiveToken}`);
    const conversation = list.body.find((c: { contactEmail: string }) => c.contactEmail === contactEmail);

    // Admin opens the conversation via the admin-only detail route.
    await request(app.getHttpServer()).get(`/conversations/${conversation.id}`).set('Authorization', `Bearer ${adminToken}`);

    const readStates = app.get<ConversationReadStateRepository>(CONVERSATION_READ_STATE_REPOSITORY);
    const adminReadState = await readStates.findForUser(conversation.id, adminUserId);
    const executiveReadState = await readStates.findForUser(conversation.id, executiveId);
    expect(adminReadState).not.toBeNull();
    expect(executiveReadState).toBeNull();
  });

  describe('admin retry endpoint', () => {
    it('is rejected for an executive (admin-only permission)', async () => {
      const response = await request(app.getHttpServer())
        .post('/integration/events/some-row-id/retry-projection')
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({});
      expect(response.status).toBe(403);
    });

    it('returns 404 for a non-existent event row when called by an admin', async () => {
      const response = await request(app.getHttpServer())
        .post('/integration/events/does-not-exist/retry-projection')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(response.status).toBe(404);
    });

    it('returns 409 when retrying an event that is not FAILED_RETRYABLE', async () => {
      const { executionId } = await seedGestion();
      await postEvent(envelope({ eventType: 'EXECUTION_ACCEPTED', aggregateId: executionId, payload: { serverExecutionId: `srv_${randomUUID()}` } }));

      const events = await request(app.getHttpServer()).get('/integration/events').set('Authorization', `Bearer ${adminToken}`);
      const processedRow = events.body.find((e: { eventType: string; status: string }) => e.eventType === 'EXECUTION_ACCEPTED' && e.status === 'PROCESSED');
      expect(processedRow).toBeDefined();

      const response = await request(app.getHttpServer())
        .post(`/integration/events/${processedRow.id}/retry-projection`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(response.status).toBe(409);
    });
  });
});
