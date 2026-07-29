import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive } from './fixtures';

/**
 * The response-outcome bar reachable from a conversation — replaces the
 * earlier Pausar/Reanudar/Finalizar/No contactar 3-dot menu. "No
 * interesado"/"Interesado" stop the WHOLE company's participation in this
 * sequence (proven here with two contacts sharing one company); "No
 * contactar" and "Deriva" stay scoped to the one contact who replied.
 */
describe('Response outcome from a conversation (e2e) — memory + simulated engine', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;
  let executiveId: string;
  let sequenceId: string;
  let mailboxId: string;
  const stamp = Date.now();

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  async function loginAs(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return response.body.accessToken as string;
  }

  function mailboxPayload(email: string) {
    return {
      name: 'Ventas Response Outcome E2E',
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

  const emails = {
    notInterestedA: `not-interested-a.${stamp}@example.com`,
    notInterestedB: `not-interested-b.${stamp}@example.com`,
    interested: `interested.${stamp}@example.com`,
    doNotContact: `do-not-contact.${stamp}@example.com`,
    deriva: `deriva.${stamp}@example.com`,
    derivaNew: `deriva-new.${stamp}@example.com`,
  };

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAs(adminEmail, adminPassword);

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    const executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;

    const executiveEmail = `response-outcome.e2e.${stamp}@mejoreferido.cl`;
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Response Outcome',
      email: executiveEmail,
      roleId: executiveRoleId,
    });
    executiveId = executive.id;
    executiveToken = executive.token;

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2012 });
    const domain = await request(app.getHttpServer())
      .post(`/clients/${client.body.id}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: `response-outcome-e2e-${stamp}.test` });
    await request(app.getHttpServer())
      .put(`/clients/${client.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });

    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload(`ventas.response-outcome.${stamp}@example.com`));
    mailboxId = mailbox.body.id;
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });

    const sequence = await request(app.getHttpServer())
      .post('/me/sequences')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'Secuencia Response Outcome E2E', timezone: 'America/Santiago' });
    sequenceId = sequence.body.id;
    await request(app.getHttpServer())
      .patch(`/me/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ mailboxId });

    const step1 = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'Envío 1', subject: 'Hola', htmlBody: '<p>Hola</p>', delayValue: 0, delayUnit: 'DAYS', sendMode: 'NEW_THREAD' });
    await request(app.getHttpServer())
      .patch(`/me/sequence-steps/${step1.body.id}`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ status: 'PUBLISHED' });
    const step2 = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'Seguimiento 2', subject: 'Seguimiento', htmlBody: '<p>Seguimiento</p>', delayValue: 2, delayUnit: 'DAYS', sendMode: 'REPLY' });
    await request(app.getHttpServer())
      .patch(`/me/sequence-steps/${step2.body.id}`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ status: 'PUBLISHED' });

    await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/publish`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('Idempotency-Key', `response-outcome-publish-${sequenceId}`)
      .send({});

    // Two contacts share "Empresa No Interesada" to prove the company-wide stop affects both.
    const csv =
      'email,firstName,company\n' +
      `${emails.notInterestedA},Ana,Empresa No Interesada\n` +
      `${emails.notInterestedB},Beto,Empresa No Interesada\n` +
      `${emails.interested},Carla,Empresa Interesada\n` +
      `${emails.doNotContact},Diego,Empresa DoNotContact\n` +
      `${emails.deriva},Elena,Empresa Deriva\n`;
    const upload = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/imports`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'contactos.csv');
    const importId = upload.body.import.id;
    await request(app.getHttpServer())
      .post(`/me/sequence-imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ email: 'email', firstName: 'firstName', company: 'company' });
    // Fase 2, Caso B — confirm() is now a single, synchronous, atomic
    // operation: no separate /advance call is needed to materialize.
    await request(app.getHttpServer())
      .post(`/me/sequence-imports/${importId}/confirm`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('Idempotency-Key', `response-outcome-confirm-${importId}`)
      .send({});

    // Batch + send step 1 for everyone, so each contact lands ACTIVE at step 2 (not COMPLETED).
    await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/batches`)
      .set('Authorization', `Bearer ${executiveToken}`);
    const scheduled = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/scheduled-emails`)
      .set('Authorization', `Bearer ${executiveToken}`);
    for (const row of scheduled.body) {
      await request(app.getHttpServer())
        .post(`/me/scheduled-emails/${row.id}/simulate-send`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({});
    }
    await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/batches`)
      .set('Authorization', `Bearer ${executiveToken}`);
  });

  afterAll(async () => {
    await app.close();
  });

  async function conversationFor(email: string): Promise<{ conversationId: string; sequenceContactId: string }> {
    const scheduled = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/scheduled-emails`)
      .set('Authorization', `Bearer ${executiveToken}`);
    const contacts = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/contacts`)
      .set('Authorization', `Bearer ${executiveToken}`);
    const contact = contacts.body.find((c: { email: string }) => c.email === email);
    const sentRow = scheduled.body.find(
      (row: { sequenceContactId: string; status: string }) =>
        row.sequenceContactId === contact.id && row.status === 'SENT',
    );
    const reply = await request(app.getHttpServer())
      .post(`/me/scheduled-emails/${sentRow.id}/simulate-reply`)
      .set('Authorization', `Bearer ${executiveToken}`)
      // OUT_OF_OFFICE deliberately does NOT auto-stop the sequence contact,
      // so status stays ACTIVE/SCHEDULED and every outcome is applicable.
      .send({ scenario: 'OUT_OF_OFFICE' });
    return { conversationId: reply.body.conversation.id as string, sequenceContactId: contact.id as string };
  }

  async function contactStatus(email: string): Promise<string> {
    const contacts = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/contacts`)
      .set('Authorization', `Bearer ${executiveToken}`);
    return contacts.body.find((c: { email: string }) => c.email === email).status;
  }

  it('No interesado stops the whole company in this sequence, not just the contact who replied', async () => {
    const { conversationId } = await conversationFor(emails.notInterestedA);

    const result = await request(app.getHttpServer())
      .post(`/me/conversations/${conversationId}/response-outcome/not-interested`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ reason: 'La empresa no está interesada' });

    expect(result.status).toBe(201);
    expect(result.body.command.commandType).toBe('PROSPECT_SEQUENCE_ACTION');
    expect(result.body.command.payload.action).toBe('NOT_INTERESTED');
    expect(result.body.affectedContacts).toBe(2);
    expect(result.body.conversation.responseOutcome).toBe('NOT_INTERESTED');

    // Both contacts of "Empresa No Interesada" are stopped, even though only A replied.
    expect(await contactStatus(emails.notInterestedA)).toBe('COMPLETED_MANUALLY');
    expect(await contactStatus(emails.notInterestedB)).toBe('COMPLETED_MANUALLY');

    // §2 — the modal's "Nota interna" is persisted as a ConversationNote tagged with the outcome.
    const notes = await request(app.getHttpServer())
      .get(`/me/conversations/${conversationId}/notes`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(notes.body).toContainEqual(
      expect.objectContaining({ content: 'La empresa no está interesada', responseOutcome: 'NOT_INTERESTED' }),
    );
  });

  it('Interesado also stops the whole company, with a distinct recorded outcome', async () => {
    const { conversationId } = await conversationFor(emails.interested);

    const result = await request(app.getHttpServer())
      .post(`/me/conversations/${conversationId}/response-outcome/interested`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ reason: 'Mostró interés' });

    expect(result.status).toBe(201);
    expect(result.body.command.payload.action).toBe('INTERESTED');
    expect(result.body.conversation.responseOutcome).toBe('INTERESTED');
    expect(await contactStatus(emails.interested)).toBe('COMPLETED_MANUALLY');

    const notes = await request(app.getHttpServer())
      .get(`/me/conversations/${conversationId}/notes`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(notes.body).toContainEqual(
      expect.objectContaining({ content: 'Mostró interés', responseOutcome: 'INTERESTED' }),
    );
  });

  it('No contactar suppresses only this address and never touches the rest of the company', async () => {
    const { conversationId } = await conversationFor(emails.doNotContact);

    const result = await request(app.getHttpServer())
      .post(`/me/conversations/${conversationId}/response-outcome/do-not-contact`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ reason: 'Solicitó no recibir más correos' });

    expect(result.status).toBe(201);
    expect(result.body.command.payload.action).toBe('DO_NOT_CONTACT');
    expect(result.body.contact.suppressed).toBe(true);
    expect(result.body.conversation.responseOutcome).toBe('DO_NOT_CONTACT');

    const notes = await request(app.getHttpServer())
      .get(`/me/conversations/${conversationId}/notes`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(notes.body).toContainEqual(
      expect.objectContaining({ content: 'Solicitó no recibir más correos', responseOutcome: 'DO_NOT_CONTACT' }),
    );

    // A second attempt must be rejected — already suppressed.
    const repeat = await request(app.getHttpServer())
      .post(`/me/conversations/${conversationId}/response-outcome/do-not-contact`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ reason: 'de nuevo' });
    expect(repeat.status).toBe(409);
  });

  it('Deriva removes the replying contact and enrolls the new one into the same sequence, sending Enviados_1 immediately when asked', async () => {
    const { conversationId } = await conversationFor(emails.deriva);

    const result = await request(app.getHttpServer())
      .post(`/me/conversations/${conversationId}/response-outcome/refer`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({
        newContactEmail: emails.derivaNew,
        newContactFirstName: 'Nuevo',
        sendFirstStepImmediately: true,
        reason: 'Derivó a otro contacto de la empresa',
      });

    expect(result.status).toBe(201);
    expect(result.body.removedSequenceContact.status).toBe('REMOVED');
    expect(result.body.newContact.email).toBe(emails.derivaNew);
    expect(result.body.sentImmediately).toBe(true);
    expect(result.body.conversation.responseOutcome).toBe('REFERRED');

    expect(await contactStatus(emails.deriva)).toBe('REMOVED');

    const scheduled = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/scheduled-emails`)
      .set('Authorization', `Bearer ${executiveToken}`);
    const newContactSend = scheduled.body.find(
      (row: { sequenceContactId: string; status: string }) =>
        row.sequenceContactId === result.body.newSequenceContact.id,
    );
    expect(newContactSend.status).toBe('SENT');

    const notes = await request(app.getHttpServer())
      .get(`/me/conversations/${conversationId}/notes`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(notes.body).toContainEqual(
      expect.objectContaining({ content: 'Derivó a otro contacto de la empresa', responseOutcome: 'REFERRED' }),
    );
  });

  it('the Cliente→Dominio→Cuenta tree aggregates unread counts hierarchically for the executive', async () => {
    const tree = await request(app.getHttpServer())
      .get('/me/conversations/tree')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(tree.status).toBe(200);
    expect(tree.body).toHaveLength(1);
    const client = tree.body[0];
    expect(client.domains).toHaveLength(1);
    const domain = client.domains[0];
    expect(domain.mailboxes).toHaveLength(1);
    expect(domain.unreadCount).toBe(domain.mailboxes[0].unreadCount);
    expect(client.unreadCount).toBe(domain.unreadCount);
  });
});
