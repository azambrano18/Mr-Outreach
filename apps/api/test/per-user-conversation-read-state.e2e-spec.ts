import { INestApplication } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { CompanyRepository } from '../src/domain/company/company.repository';
import { ContactRepository } from '../src/domain/contact/contact.repository';
import { ProspectImportRowRepository } from '../src/domain/prospect-import/prospect-import-row.repository';
import { SequenceExecutionRepository } from '../src/domain/sequence-execution/sequence-execution.repository';
import {
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  PROSPECT_IMPORT_ROW_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
} from '../src/infrastructure/persistence/tokens';
import { MOTOR_EVENT_SCHEMA_VERSION } from '../src/modules/integration/dto/motor-event-envelope.dto';
import { createTestApp } from './create-test-app';
import { createReadyExecutive, linkClientMailbox } from './fixtures';

/**
 * Fase "Estado leído/no leído por usuario" — HTTP-level evidence that
 * ConversationSummary.isUnread and ConversationCounters.unread are
 * genuinely independent per authenticated caller, not the coarse legacy
 * flag. Builds on the same Gestión-seeding + signed-event pattern as
 * motor-events.e2e-spec.ts, but asserts on the VISIBLE fields the admin
 * and executive endpoints return, not just the underlying storage.
 */
describe('Per-user conversation read state (e2e) — memory + HMAC', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;
  let executiveId: string;
  let organizationId: string;
  let mailboxId: string;
  let clientId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const hmacSecret = process.env.MOTOR_EVENT_HMAC_SECRET as string;

  function sign(timestamp: string, rawBody: string): string {
    return createHmac('sha256', hmacSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  }

  async function postEvent(body: unknown) {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, raw);
    return request(app.getHttpServer())
      .post('/integration/events')
      .set('Content-Type', 'application/json')
      .set('X-Motor-Timestamp', timestamp)
      .set('X-Motor-Signature', signature)
      .send(raw);
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
    organizationId = me.body.organizationId;

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    const executiveRoleId = roles.body.find((r: { name: string }) => r.name === 'EXECUTIVE').id;
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Read State',
      email: `read-state-exec-${Date.now()}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    executiveId = executive.id;
    executiveToken = executive.token;

    const linked = await linkClientMailbox(app, adminToken, executiveId, { clientName: 'Cliente Read State E2E' });
    mailboxId = linked.mailboxId;
    clientId = linked.clientId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedConversationWithInboundReply() {
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
    const company = await companies.create({ organizationId, clientId, rawName: `Empresa Read State ${randomUUID().slice(0, 6)}` });
    const email = `prospecto-${randomUUID().slice(0, 8)}@empresa-read-state.test`;
    const contact = await contacts.create({ organizationId, clientId, companyId: company.id, email, fullName: 'Prospecto Read State' });
    const [row] = await rows.createMany([
      {
        organizationId,
        importId: `imp_${randomUUID()}`,
        rowNumber: 1,
        rawData: { email },
        normalizedData: { email, contactName: 'Prospecto Read State', companyName: company.rawName, variables: {} },
        validationStatus: 'VALID',
      },
    ]);
    await rows.bulkSetResolvedIdentity([{ rowId: row.id, companyId: company.id, contactId: contact.id }], new Date());

    const outboundMessageId = `out_${randomUUID()}`;
    await postEvent(envelope({ eventType: 'EXECUTION_ACCEPTED', aggregateId: execution.id, payload: { serverExecutionId: `srv_${randomUUID()}` } }));
    await postEvent(
      envelope({
        eventType: 'OUTBOUND_MESSAGE_CREATED',
        aggregateId: execution.id,
        payload: {
          outboundMessageId,
          mailboxId,
          prospectImportRowId: row.id,
          recipientEmail: email,
          subject: 'Hola',
          htmlBody: '<p>Hola</p>',
          plainTextBody: 'Hola',
        },
      }),
    );
    const inbound = await postEvent(
      envelope({
        eventType: 'INBOUND_MESSAGE_RECEIVED',
        aggregateId: execution.id,
        payload: {
          mailboxId,
          emailMessageId: `in_${randomUUID()}`,
          senderEmail: email,
          subject: 'Re: Hola',
          htmlBody: '<p>Gracias</p>',
          plainTextBody: 'Gracias',
          outboundMessageId,
        },
      }),
    );
    expect(inbound.status).toBe(200);

    const list = await request(app.getHttpServer()).get('/me/conversations').set('Authorization', `Bearer ${executiveToken}`);
    const conversation = list.body.find((c: { contactEmail: string }) => c.contactEmail === email);
    return conversation.id as string;
  }

  it('shows the new reply as unread for both the admin and the assigned executive', async () => {
    const conversationId = await seedConversationWithInboundReply();

    const executiveList = await request(app.getHttpServer()).get('/me/conversations').set('Authorization', `Bearer ${executiveToken}`);
    const adminList = await request(app.getHttpServer()).get('/conversations').set('Authorization', `Bearer ${adminToken}`);

    expect(executiveList.body.find((c: { id: string }) => c.id === conversationId).isUnread).toBe(true);
    expect(adminList.body.find((c: { id: string }) => c.id === conversationId).isUnread).toBe(true);
  });

  it('admin opening the conversation marks it read only for the admin — the executive still sees it unread', async () => {
    const conversationId = await seedConversationWithInboundReply();

    const opened = await request(app.getHttpServer()).get(`/conversations/${conversationId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(opened.status).toBe(200);
    expect(opened.body.isUnread).toBe(false);

    const adminList = await request(app.getHttpServer()).get('/conversations').set('Authorization', `Bearer ${adminToken}`);
    const executiveList = await request(app.getHttpServer()).get('/me/conversations').set('Authorization', `Bearer ${executiveToken}`);
    expect(adminList.body.find((c: { id: string }) => c.id === conversationId).isUnread).toBe(false);
    expect(executiveList.body.find((c: { id: string }) => c.id === conversationId).isUnread).toBe(true);
  });

  it('the executive opening it afterwards marks it read for the executive too, independently of the admin', async () => {
    const conversationId = await seedConversationWithInboundReply();
    await request(app.getHttpServer()).get(`/conversations/${conversationId}`).set('Authorization', `Bearer ${adminToken}`);

    const openedByExecutive = await request(app.getHttpServer())
      .get(`/me/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(openedByExecutive.status).toBe(200);
    expect(openedByExecutive.body.isUnread).toBe(false);
  });

  it('the ?unread=true filter and the unread counter agree, per caller', async () => {
    const conversationId = await seedConversationWithInboundReply();

    const beforeCounters = await request(app.getHttpServer()).get('/me/conversations/counters').set('Authorization', `Bearer ${executiveToken}`);
    const beforeUnreadList = await request(app.getHttpServer())
      .get('/me/conversations?unread=true')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(beforeUnreadList.body.some((c: { id: string }) => c.id === conversationId)).toBe(true);
    expect(beforeCounters.body.unread).toBe(beforeUnreadList.body.length);

    await request(app.getHttpServer()).get(`/me/conversations/${conversationId}`).set('Authorization', `Bearer ${executiveToken}`);

    const afterCounters = await request(app.getHttpServer()).get('/me/conversations/counters').set('Authorization', `Bearer ${executiveToken}`);
    const afterUnreadList = await request(app.getHttpServer())
      .get('/me/conversations?unread=true')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(afterUnreadList.body.some((c: { id: string }) => c.id === conversationId)).toBe(false);
    expect(afterCounters.body.unread).toBe(beforeCounters.body.unread - 1);
  });
});
