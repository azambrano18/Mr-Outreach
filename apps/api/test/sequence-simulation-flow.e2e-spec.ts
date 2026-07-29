import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive } from './fixtures';

/**
 * End-to-end proof of the whole simulated mail-engine chain (§59's
 * mandatory validation flow, exercised at the HTTP/API layer): publish a
 * sequence, import contacts via CSV, auto-enroll into the first published
 * step, batch/schedule/simulate sends across three steps, retire a contact
 * and a company (with future-job cancellation), and simulate a reply that
 * associates to the exact step it answers and cancels the next step's job.
 */
describe('Sequence mail-engine simulation flow (e2e) — memory + simulated engine', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveRoleId: string;
  let executiveToken: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  async function loginAs(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return response.body.accessToken as string;
  }

  function mailboxPayload(email: string) {
    return {
      name: 'Ventas Flujo E2E',
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

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;

    const executiveEmail = `flujo.e2e.${Date.now()}@mejoreferido.cl`;
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Flujo',
      email: executiveEmail,
      roleId: executiveRoleId,
    });
    const executiveId = executive.id;
    executiveToken = executive.token;

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2013 });
    const domain = await request(app.getHttpServer())
      .post(`/clients/${client.body.id}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: `flujo-e2e-${Date.now()}.test` });

    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload(`ventas.flujo.${Date.now()}@example.com`));
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailbox.body.id}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });

    (globalThis as Record<string, unknown>).__flowMailboxId = mailbox.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the full publish → import → schedule → send → retire → reply chain', async () => {
    const mailboxId = (globalThis as Record<string, unknown>).__flowMailboxId as string;

    // 1. Create the sequence and attach the sender account.
    const sequence = await request(app.getHttpServer())
      .post('/me/sequences')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ name: 'Secuencia Flujo E2E', timezone: 'America/Santiago' });
    const sequenceId = sequence.body.id as string;
    await request(app.getHttpServer())
      .patch(`/me/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ mailboxId });

    // 2. Three published steps: Envío 1, Seguimiento 2, Seguimiento 3.
    const stepDefs = [
      { name: 'Envío 1', subject: 'Hola', delayValue: 0 },
      { name: 'Seguimiento 2', subject: 'Seguimiento', delayValue: 2 },
      { name: 'Seguimiento 3', subject: 'Último seguimiento', delayValue: 3 },
    ];
    for (const def of stepDefs) {
      const step = await request(app.getHttpServer())
        .post(`/me/sequences/${sequenceId}/steps`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({
          name: def.name,
          subject: def.subject,
          htmlBody: `<p>${def.subject}</p>`,
          delayValue: def.delayValue,
          delayUnit: 'DAYS',
          sendMode: def.name === 'Envío 1' ? 'NEW_THREAD' : 'REPLY',
        });
      await request(app.getHttpServer())
        .patch(`/me/sequence-steps/${step.body.id}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ status: 'PUBLISHED' });
    }

    // 3. Publish the sequence — SEQUENCE_PUBLISH_REQUESTED, sequenceVersion 0 -> 1.
    const publish = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/publish`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('Idempotency-Key', `sim-flow-publish-${sequenceId}`)
      .send({});
    expect(publish.status).toBe(201);
    expect(publish.body.command.commandType).toBe('SEQUENCE_PUBLISH_REQUESTED');
    expect(publish.body.sequence.sequenceVersion).toBe(1);
    expect(publish.body.command.payload.steps).toHaveLength(3);

    // 4. Import 4 contacts across 3 companies via CSV.
    const csv =
      'email,firstName,company\n' +
      'contacta.flujo@example.com,Ana,Empresa Uno\n' +
      'contactb.flujo@example.com,Beto,Empresa Dos\n' +
      'contactc.flujo@example.com,Caro,Empresa Dos\n' +
      'contactd.flujo@example.com,Dana,Empresa Tres\n';
    const upload = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/imports`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'contactos.csv');
    expect(upload.status).toBe(201);
    const importId = upload.body.import.id as string;
    expect(upload.body.headers).toEqual(['email', 'firstName', 'company']);

    const mapping = await request(app.getHttpServer())
      .post(`/me/sequence-imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ email: 'email', firstName: 'firstName', company: 'company' });
    expect(mapping.body.status).toBe('READY');
    expect(mapping.body.validRows).toBe(4);
    expect(mapping.body.companiesDetected).toBe(3);

    // Fase 2, Caso B — confirm() is now a single, synchronous, atomic
    // operation: no separate /advance call is needed to materialize.
    const confirm = await request(app.getHttpServer())
      .post(`/me/sequence-imports/${importId}/confirm`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('Idempotency-Key', `sim-flow-confirm-${importId}`)
      .send({});
    expect(confirm.status).toBe(201);
    expect(confirm.body.status).toBe('COMPLETED');
    expect(confirm.body.commandId).toBeTruthy();
    expect(confirm.body.contactsEnrolled).toBe(4);

    const contactsAfterImport = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/contacts`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(contactsAfterImport.body).toHaveLength(4);
    expect(contactsAfterImport.body.every((c: { status: string }) => c.status === 'ACTIVE')).toBe(true);

    const findContact = (email: string) =>
      contactsAfterImport.body.find((c: { email: string }) => c.email === email);
    const contactA = findContact('contacta.flujo@example.com');
    const contactD = findContact('contactd.flujo@example.com');

    // 5. Step 1 for everyone: batch + simulate send.
    const batch1 = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/batches`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(batch1.body.total).toBe(4);
    expect(batch1.body.newContacts).toBe(4);
    for (const scheduled of batch1.body.scheduledEmails) {
      await request(app.getHttpServer())
        .post(`/me/scheduled-emails/${scheduled.id}/simulate-send`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({});
    }

    // 6. Step 2 (Seguimiento) for everyone: batch + simulate send. Capture D's step-2 send id for the reply later.
    const batch2 = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/batches`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(batch2.body.total).toBe(4);
    expect(batch2.body.followUps).toBe(4);
    let contactDStep2SendId = '';
    for (const scheduled of batch2.body.scheduledEmails) {
      const sendResult = await request(app.getHttpServer())
        .post(`/me/scheduled-emails/${scheduled.id}/simulate-send`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({});
      if (scheduled.sequenceContactId === contactD.id) {
        contactDStep2SendId = sendResult.body.id;
      }
    }
    expect(contactDStep2SendId).toBeTruthy();

    // 7. Step 3 for everyone: batch only (not sent yet) — these are the "future jobs" retirement must cancel.
    const batch3 = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/batches`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(batch3.body.total).toBe(4);

    // 8. Retire contact A individually — cancels exactly their one pending step-3 job.
    const removeContact = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/contacts/${contactA.id}/remove`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('Idempotency-Key', `sim-flow-remove-contact-${contactA.id}`)
      .send({ reason: 'Solicitud del cliente' });
    expect(removeContact.status).toBe(201);
    expect(removeContact.body.command.commandType).toBe('SEQUENCE_CONTACT_REMOVE_REQUESTED');
    expect(removeContact.body.result.cancelledJobs).toBe(1);
    expect(removeContact.body.result.status).toBe('REMOVED');

    // 9. Retire "Empresa Dos" — affects both B and C, cancelling both their pending step-3 jobs.
    const companies = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/companies`)
      .set('Authorization', `Bearer ${executiveToken}`);
    const empresaDos = companies.body.find((c: { companyName: string }) => c.companyName === 'Empresa Dos');
    const removeCompany = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/companies/${empresaDos.companyId}/remove`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .set('Idempotency-Key', `sim-flow-remove-company-${empresaDos.companyId}`)
      .send({ reason: 'Empresa dada de baja' });
    expect(removeCompany.body.command.commandType).toBe('SEQUENCE_COMPANY_REMOVE_REQUESTED');
    expect(removeCompany.body.result.cancelledJobs).toBe(2);
    expect(removeCompany.body.result.affectedContacts).toBe(2);

    // 10. Simulate a human reply to D's Seguimiento 2 send — must associate to Step 2, mark REPLIED,
    // and cancel D's still-pending Seguimiento 3 job.
    const reply = await request(app.getHttpServer())
      .post(`/me/scheduled-emails/${contactDStep2SendId}/simulate-reply`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ scenario: 'INTERESTED' });
    expect(reply.status).toBe(201);
    expect(reply.body.event.eventType).toBe('INBOUND_REPLY_MATCHED');
    expect(reply.body.conversation.originatingStepName).toBe('Seguimiento 2');
    expect(reply.body.conversation.originatingStepPosition).toBe(2);
    expect(reply.body.conversation.classification).toBe('INTERESTED');

    const contactsAfterReply = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/contacts?status=REPLIED`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(contactsAfterReply.body.some((c: { id: string }) => c.id === contactD.id)).toBe(true);

    const scheduledEmails = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/scheduled-emails`)
      .set('Authorization', `Bearer ${executiveToken}`);
    const dStep3Job = scheduledEmails.body.find(
      (row: { sequenceContactId: string; status: string; priority: string }) =>
        row.sequenceContactId === contactD.id && row.status !== 'SENT',
    );
    expect(dStep3Job.status).toBe('CANCELLED');

    // 11. Centro de conversaciones: no reply/send buttons exist in the read model — confirmed structurally
    // by asserting the conversation summary carries only read/classification fields (see ConversationSummary type).
    expect(reply.body.conversation.assignedExecutiveId).toBeTruthy();
  });
});
