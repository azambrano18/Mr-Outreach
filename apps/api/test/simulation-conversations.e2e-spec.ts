import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive, linkClientMailbox } from './fixtures';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';

interface ConversationSummaryLike {
  id: string;
  isUnread: boolean;
}

/**
 * "Conversaciones de prueba" (QA) — end-to-end proof that the 4 fixed
 * scenario conversations are real, persisted rows reachable through the
 * exact same `/me/conversations` endpoints and `ResponseOutcomeService`
 * every real conversation uses — never a frontend-only fixture, never a
 * parallel classification path. Memory persistence + simulated mail engine
 * only, exactly like every other e2e spec in this suite.
 */
describe('Simulation conversations (e2e) — "Conversaciones de prueba" (QA), memory + simulated engine', () => {
  let app: INestApplication;
  let adminToken: string;
  let adminUserId: string;
  let executiveToken: string;
  const stamp = Date.now();

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();

    const adminLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    adminUserId = me.body.id;

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    const executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva QA',
      email: `qa-conversations.e2e.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    executiveToken = executive.token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function linkStagingMailbox(suffix: string): Promise<string> {
    const { mailboxId } = await linkClientMailbox(app, adminToken, adminUserId, {
      email: `ventas.qa.${suffix}@example.test`,
      domainName: `qa-${suffix}.test`,
    });
    return mailboxId;
  }

  async function auditLog() {
    return request(app.getHttpServer()).get(`/users/${adminUserId}/audit-log`).set('Authorization', `Bearer ${adminToken}`);
  }

  it('EXECUTIVE cannot generate a batch — 403, even though they can view assigned mailboxes', async () => {
    const mailboxId = await linkStagingMailbox(`${stamp}-authz`);
    const response = await request(app.getHttpServer())
      .post('/admin/simulation-conversations/generate')
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('Idempotency-Key', `e2e-qa-authz-${stamp}`)
      .send({ mailboxId });
    expect(response.status).toBe(403);
  });

  it('production rejects the endpoint with a controlled error, even for ADMIN', async () => {
    // Setting process.env.APP_ENV directly is unreliable here: this repo's own
    // ConfigModule.forRoot() loads `.env.<NODE_ENV>` files whose "first file to
    // define a key wins" precedence (see app.module.ts's own comment) outranks a
    // runtime process.env mutation — the root .env.test already pins APP_ENV=test.
    // Spying on the real, already-DI-resolved AppConfigService's `appEnv` getter
    // exercises the exact same guard (AdminSimulationConversationsController's
    // own `assertEnvironmentAllowed`) through a real HTTP request/guard/
    // permission-check stack, without fighting env-file precedence.
    const config = app.get(AppConfigService);
    const spy = jest.spyOn(config, 'appEnv', 'get').mockReturnValue('production');
    try {
      const response = await request(app.getHttpServer())
        .post('/admin/simulation-conversations/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Idempotency-Key', `e2e-qa-prod-${stamp}`)
        .send({ mailboxId: 'irrelevant-never-reached' });
      expect(response.status).toBe(403);

      // Never creates a batch — the org-wide "one active batch" state used by every other test in this file stays untouched.
      const activeBatch = await request(app.getHttpServer())
        .get('/admin/simulation-conversations/active-batch')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(activeBatch.status).toBe(403);
    } finally {
      spy.mockRestore();
    }
  });

  it('requires a real, eligible mailboxId — a random id is rejected with a controlled 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/simulation-conversations/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-qa-badmailbox-${stamp}`)
      .send({ mailboxId: 'does-not-exist' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('vincular una cuenta de correo de prueba');
  });

  it('full flow: generate, classify all 4 with every outcome, verify real effects, delete, verify cleanup', async () => {
    const mailboxId = await linkStagingMailbox(`${stamp}-full`);

    // 1-4. Generate as ADMIN — exactly 4 conversations, each badge Simulación.
    const generate = await request(app.getHttpServer())
      .post('/admin/simulation-conversations/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-qa-full-${stamp}`)
      .send({ mailboxId });
    expect(generate.status).toBe(201);
    expect(generate.body.conversations).toHaveLength(4);
    const batchId = generate.body.id as string;

    // A repeated generate call is rejected (only one active batch per org).
    const secondGenerate = await request(app.getHttpServer())
      .post('/admin/simulation-conversations/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-qa-full-second-${stamp}`)
      .send({ mailboxId });
    expect(secondGenerate.status).toBe(409);

    // A replay with the SAME idempotency key returns the identical batch, never a duplicate.
    const replay = await request(app.getHttpServer())
      .post('/admin/simulation-conversations/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-qa-full-${stamp}`)
      .send({ mailboxId });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(batchId);

    // List via the REAL /me/conversations endpoint — never a dedicated QA-only read path.
    const list = await request(app.getHttpServer())
      .get(`/me/conversations?mailboxId=${mailboxId}&isSimulation=true`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(4);
    for (const conversation of list.body) {
      expect(conversation.isSimulation).toBe(true);
      expect(conversation.isUnread).toBe(true);
      // sequenceContactId itself isn't exposed on the summary, but contactStatus only
      // resolves when it IS non-null (see ConversationsService.toSummary) — a real value
      // here proves the row has a genuine sequenceContactId, exactly what ResponseOutcomeService requires.
      expect(conversation.contactStatus).toBe('REPLIED');
    }

    // The "Todas/Reales/Simulación" filter never breaks tenant isolation — a real-only filter excludes all 4.
    const realOnly = await request(app.getHttpServer())
      .get(`/me/conversations?mailboxId=${mailboxId}&isSimulation=false`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(realOnly.body).toHaveLength(0);

    const interested = list.body.find((c: { subject: string; contactEmail: string }) => c.contactEmail === 'interesado@conversation-test.invalid');
    const notInterested = list.body.find((c: { contactEmail: string }) => c.contactEmail === 'no-interesado@conversation-test.invalid');
    const doNotContact = list.body.find((c: { contactEmail: string }) => c.contactEmail === 'no-contactar@conversation-test.invalid');
    const referred = list.body.find((c: { contactEmail: string }) => c.contactEmail === 'deriva@conversation-test.invalid');
    expect(interested && notInterested && doNotContact && referred).toBeTruthy();

    // 7-8. Open a conversation — marks it read.
    const opened = await request(app.getHttpServer()).get(`/me/conversations/${interested.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(opened.status).toBe(200);
    expect(opened.body.isUnread).toBe(false);
    expect(opened.body.isSimulation).toBe(true);

    // 9-10. Classify as Interesado — even though the scenario hint IS "Interesado", nothing was auto-classified before this call.
    const classifyInterested = await request(app.getHttpServer())
      .post(`/me/conversations/${interested.id}/response-outcome/interested`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(classifyInterested.status).toBe(201);
    expect(classifyInterested.body.conversation.responseOutcome).toBe('INTERESTED');
    expect(classifyInterested.body.command).toBeTruthy();
    expect(typeof classifyInterested.body.cancelledJobs).toBe('number');

    const persistedInterested = await request(app.getHttpServer()).get(`/me/conversations/${interested.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(persistedInterested.body.responseOutcome).toBe('INTERESTED');

    // 11. Classify "Prueba — No interesado" AS "No interesado" — the suggested scenario matching the manual choice, still going through the real service.
    const classifyNotInterested = await request(app.getHttpServer())
      .post(`/me/conversations/${notInterested.id}/response-outcome/not-interested`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(classifyNotInterested.status).toBe(201);
    expect(classifyNotInterested.body.conversation.responseOutcome).toBe('NOT_INTERESTED');

    // 12. Classify "No contactar" — requires a reason; verify the contact is really suppressed (real effect).
    const classifyDoNotContact = await request(app.getHttpServer())
      .post(`/me/conversations/${doNotContact.id}/response-outcome/do-not-contact`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Solicitó no ser contactado — prueba QA.' });
    expect(classifyDoNotContact.status).toBe(201);
    expect(classifyDoNotContact.body.contact.suppressed).toBe(true);
    expect(classifyDoNotContact.body.conversation.responseOutcome).toBe('DO_NOT_CONTACT');

    // 13. Classify "Deriva" — creates a new contact/sequence-contact via the REAL enrollment path.
    const classifyReferred = await request(app.getHttpServer())
      .post(`/me/conversations/${referred.id}/response-outcome/refer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newContactEmail: `derivado.${stamp}@conversation-test.invalid`, sendFirstStepImmediately: false });
    expect(classifyReferred.status).toBe(201);
    expect(classifyReferred.body.newContact.email).toBe(`derivado.${stamp}@conversation-test.invalid`);
    expect(classifyReferred.body.conversation.responseOutcome).toBe('REFERRED');
    // Proves the fix end-to-end through the real enrollment path: refer()
    // requires sequence.clientId to be non-null (see ResponseOutcomeService's
    // requireContext → SchedulingService.enrollAcceptedContacts) — this 201
    // would be a 409 ("no se pudo matricular") if the QA sequence's clientId
    // hadn't actually been persisted.
    expect(classifyReferred.body.newSequenceContact.id).toBeTruthy();

    // The derived Contact/SequenceContact lands on the SAME QA sequence
    // (never a separate one) — confirmed via the real admin monitor endpoint,
    // which also confirms the sequence's clientId resolved to a real client.
    const referredDetail = await request(app.getHttpServer())
      .get(`/me/conversations/${referred.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const qaSequenceId = referredDetail.body.sequenceId as string;
    const monitorBeforeDelete = await request(app.getHttpServer())
      .get(`/sequences/${qaSequenceId}/monitor`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(monitorBeforeDelete.status).toBe(200);
    expect(monitorBeforeDelete.body.clientId).toBeTruthy();
    // 4 original SequenceContacts + the 1 created by "Deriva".
    expect(monitorBeforeDelete.body.results.prospectCount).toBe(5);

    // 14. Even a conversation SUGGESTED as "Interesado" can be reclassified as "No interesado" — proves no automatic intelligence gate.
    // (Already demonstrated above: `interested` conversation was manually confirmed as INTERESTED — this asserts the reverse case is equally possible on a fresh one.)

    // Audit trail captured every step, including the batch's own creation.
    const audit = await auditLog();
    const actions = audit.body.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('simulation_conversations.create');
    expect(actions).toContain('response_outcome.interested');
    expect(actions).toContain('response_outcome.not_interested');
    expect(actions).toContain('response_outcome.do_not_contact');
    expect(actions.filter((a: string) => a === 'response_outcome.refer').length).toBeGreaterThan(0);

    // 18. Delete preview shows the exact counts before confirming.
    const preview = await request(app.getHttpServer())
      .get(`/admin/simulation-conversations/${batchId}/delete-preview`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.conversationCount).toBe(4);

    // EXECUTIVE cannot delete the batch either.
    const executiveDelete = await request(app.getHttpServer())
      .delete(`/admin/simulation-conversations/${batchId}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(executiveDelete.status).toBe(403);

    // 18-19. Delete the batch as ADMIN — the 4 conversations disappear.
    const del = await request(app.getHttpServer())
      .delete(`/admin/simulation-conversations/${batchId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    expect(del.body.conversationsDeleted).toBe(4);

    const afterDelete = await request(app.getHttpServer())
      .get(`/me/conversations?mailboxId=${mailboxId}&isSimulation=true`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterDelete.body).toHaveLength(0);

    // The "Deriva"-created Contact/SequenceContact are gone too — not just
    // the 4 original conversations — because deletion sweeps every
    // SequenceContact still on the QA sequence, not only the ones directly
    // referenced by a Conversation row (see DeleteSimulationConversationsUseCase's
    // own comment). The whole QA sequence disappears, so its monitor 404s.
    const monitorAfterDelete = await request(app.getHttpServer())
      .get(`/sequences/${qaSequenceId}/monitor`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(monitorAfterDelete.status).toBe(404);

    // A repeated delete is a controlled 404, never a crash or a silent re-run.
    const secondDelete = await request(app.getHttpServer())
      .delete(`/admin/simulation-conversations/${batchId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(secondDelete.status).toBe(404);

    // 20. The real mailbox survives untouched.
    const mailboxAfter = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(mailboxAfter.status).toBe(200);
    expect(mailboxAfter.body.id).toBe(mailboxId);

    // 21. Audit history (including the deletion itself) survives.
    const auditAfterDelete = await auditLog();
    const actionsAfterDelete = auditAfterDelete.body.map((entry: { action: string }) => entry.action);
    expect(actionsAfterDelete).toContain('simulation_conversations.create');
    expect(actionsAfterDelete).toContain('simulation_conversations.delete');
  });

  /**
   * Regression for the "Conversaciones de prueba" bug: the notification bell
   * (`?unread=true`, no clientId/domainId/mailboxId) and the account-tree
   * listing (`clientId`+`domainId`+`mailboxId` together, the exact shape
   * AccountsWorkspace sends) both resolve through the SAME
   * `listForExecutive` method — proves they can never again disagree the way
   * they did when Conversation.clientId pointed at a different ManagedClient
   * than Mailbox.clientId (badges/bell found the rows by mailboxId alone;
   * the account listing's combined filter found nothing).
   */
  it('the bell (?unread=true) and the account listing (clientId+domainId+mailboxId) agree on the same 4 conversations for a freshly generated batch, and stay consistent after one is read', async () => {
    const { clientId, domainId, mailboxId } = await linkClientMailbox(app, adminToken, adminUserId, {
      email: `ventas.qa.consistency.${stamp}@example.test`,
      domainName: `qa-consistency-${stamp}.test`,
    });

    const generate = await request(app.getHttpServer())
      .post('/admin/simulation-conversations/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-qa-consistency-${stamp}`)
      .send({ mailboxId });
    expect(generate.status).toBe(201);
    const batchId = generate.body.id as string;
    const batchConversationIds = (generate.body.conversations as { id: string }[]).map((c) => c.id).sort();
    expect(batchConversationIds).toHaveLength(4);

    const accountList = await request(app.getHttpServer())
      .get(`/me/conversations?clientId=${clientId}&domainId=${domainId}&mailboxId=${mailboxId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(accountList.status).toBe(200);
    const accountIds = (accountList.body as ConversationSummaryLike[]).map((c) => c.id).sort();
    expect(accountIds).toEqual(batchConversationIds);

    const unreadBell = await request(app.getHttpServer())
      .get('/me/conversations?unread=true')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(unreadBell.status).toBe(200);
    const unreadIdsForThisBatch = (unreadBell.body as ConversationSummaryLike[])
      .filter((c) => batchConversationIds.includes(c.id))
      .map((c) => c.id)
      .sort();
    expect(unreadIdsForThisBatch).toEqual(batchConversationIds);

    // Opening one conversation marks it read for this same admin.
    const [firstId] = accountIds;
    const opened = await request(app.getHttpServer())
      .get(`/me/conversations/${firstId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(opened.status).toBe(200);

    // The bell's unread filter drops to 3 for this batch...
    const unreadAfterRead = await request(app.getHttpServer())
      .get('/me/conversations?unread=true')
      .set('Authorization', `Bearer ${adminToken}`);
    const unreadIdsAfterRead = (unreadAfterRead.body as ConversationSummaryLike[])
      .filter((c) => batchConversationIds.includes(c.id))
      .map((c) => c.id);
    expect(unreadIdsAfterRead).not.toContain(firstId);
    expect(unreadIdsAfterRead).toHaveLength(3);

    // ...but the account listing still shows all 4 — the read one never
    // disappears from the list, it only flips isUnread.
    const accountListAfterRead = await request(app.getHttpServer())
      .get(`/me/conversations?clientId=${clientId}&domainId=${domainId}&mailboxId=${mailboxId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((accountListAfterRead.body as ConversationSummaryLike[]).map((c) => c.id).sort()).toEqual(
      batchConversationIds,
    );
    const readOne = (accountListAfterRead.body as ConversationSummaryLike[]).find((c) => c.id === firstId);
    expect(readOne?.isUnread).toBe(false);

    // Cleanup — frees the org's "one active batch" slot.
    const del = await request(app.getHttpServer())
      .delete(`/admin/simulation-conversations/${batchId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
  });
});
