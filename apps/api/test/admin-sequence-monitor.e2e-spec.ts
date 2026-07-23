import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive } from './fixtures';

/**
 * Spec §4 — the admin's global "todas las secuencias" monitoring panel.
 * Runs a real publish → import → send → reply chain (self-service, the
 * normal executive path) and then verifies the admin-only aggregation
 * endpoints report the exact same numbers, plus the admin-only actions
 * (cancel pending sends, retire a prospect) and permission gating.
 */
describe('Admin sequence monitoring panel (e2e) — memory + simulated engine', () => {
  let app: INestApplication;
  let adminToken: string;
  let executive: { id: string; email: string; token: string };
  let clientId: string;
  let sequenceId: string;
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

    executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Monitor',
      email: `admin-monitor.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crmClientId: 2048 });
    clientId = client.body.id;
    await request(app.getHttpServer())
      .put(`/clients/${clientId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executive.id, secondaryUserIds: [] });

    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName: `admin-monitor-${stamp}.test` });
    const mailboxEmail = `ventas.monitor.${stamp}@example.com`;
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Ventas Monitor E2E',
        email: mailboxEmail,
        fromName: 'Equipo de Ventas',
        imap: {
          host: 'imap.example.com',
          port: 993,
          encryption: 'SSL_TLS',
          username: mailboxEmail,
          password: 'super-secret-imap-password',
          verifyCertificate: true,
        },
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          encryption: 'STARTTLS',
          username: mailboxEmail,
          password: 'super-secret-smtp-password',
          verifyCertificate: true,
        },
      });
    const mailboxId = mailbox.body.id;
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executive.id, secondaryUserIds: [] });

    // ---- Self-service: executive builds and runs a real sequence ----
    const sequence = await request(app.getHttpServer())
      .post('/me/sequences')
      .set('Authorization', `Bearer ${executive.token}`)
      .send({ name: 'Secuencia Monitor E2E', timezone: 'America/Santiago' });
    sequenceId = sequence.body.id;
    await request(app.getHttpServer())
      .patch(`/me/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${executive.token}`)
      .send({ mailboxId });

    const stepDefs = [
      { name: 'Envío 1', subject: 'Hola', delayValue: 0, sendMode: 'NEW_THREAD' },
      { name: 'Seguimiento 2', subject: 'Seguimiento', delayValue: 2, sendMode: 'REPLY' },
      { name: 'Seguimiento 3', subject: 'Último seguimiento', delayValue: 3, sendMode: 'REPLY' },
    ];
    for (const def of stepDefs) {
      const step = await request(app.getHttpServer())
        .post(`/me/sequences/${sequenceId}/steps`)
        .set('Authorization', `Bearer ${executive.token}`)
        .send({
          name: def.name,
          subject: def.subject,
          htmlBody: `<p>${def.subject}</p>`,
          delayValue: def.delayValue,
          delayUnit: 'DAYS',
          sendMode: def.sendMode,
        });
      await request(app.getHttpServer())
        .patch(`/me/sequence-steps/${step.body.id}`)
        .set('Authorization', `Bearer ${executive.token}`)
        .send({ status: 'PUBLISHED' });
    }

    await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/publish`)
      .set('Authorization', `Bearer ${executive.token}`)
      .send({});

    const csv = 'email,firstName,company\ncontacta.monitor@example.com,Ana,Empresa Uno\ncontactb.monitor@example.com,Beto,Empresa Dos\n';
    const upload = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/imports`)
      .set('Authorization', `Bearer ${executive.token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'contactos.csv');
    const importId = upload.body.import.id;
    await request(app.getHttpServer())
      .post(`/me/sequence-imports/${importId}/mapping`)
      .set('Authorization', `Bearer ${executive.token}`)
      .send({ email: 'email', firstName: 'firstName', company: 'company' });
    await request(app.getHttpServer())
      .post(`/me/sequence-imports/${importId}/confirm`)
      .set('Authorization', `Bearer ${executive.token}`)
      .send({});
    await request(app.getHttpServer())
      .post(`/me/sequence-imports/${importId}/advance`)
      .set('Authorization', `Bearer ${executive.token}`)
      .send({ mode: 'ALL' });

    const contacts = await request(app.getHttpServer())
      .get(`/me/sequences/${sequenceId}/contacts`)
      .set('Authorization', `Bearer ${executive.token}`);
    const contactA = contacts.body.find((c: { email: string }) => c.email === 'contacta.monitor@example.com');
    const contactB = contacts.body.find((c: { email: string }) => c.email === 'contactb.monitor@example.com');

    // Step 1 for both.
    const batch1 = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/batches`)
      .set('Authorization', `Bearer ${executive.token}`);
    for (const scheduled of batch1.body.scheduledEmails) {
      await request(app.getHttpServer())
        .post(`/me/scheduled-emails/${scheduled.id}/simulate-send`)
        .set('Authorization', `Bearer ${executive.token}`)
        .send({});
    }

    // Step 2 for both — capture B's send id to simulate a reply.
    const batch2 = await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/batches`)
      .set('Authorization', `Bearer ${executive.token}`);
    let contactBStep2SendId = '';
    for (const scheduled of batch2.body.scheduledEmails) {
      const sent = await request(app.getHttpServer())
        .post(`/me/scheduled-emails/${scheduled.id}/simulate-send`)
        .set('Authorization', `Bearer ${executive.token}`)
        .send({});
      if (scheduled.sequenceContactId === contactB.id) contactBStep2SendId = sent.body.id;
    }

    // Step 3 batch only — these become the "pending" jobs the admin will later cancel.
    await request(app.getHttpServer())
      .post(`/me/sequences/${sequenceId}/batches`)
      .set('Authorization', `Bearer ${executive.token}`);

    // B replies to step 2.
    await request(app.getHttpServer())
      .post(`/me/scheduled-emails/${contactBStep2SendId}/simulate-reply`)
      .set('Authorization', `Bearer ${executive.token}`)
      .send({ scenario: 'INTERESTED' });

    void contactA;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the sequence with correctly aggregated stats', async () => {
    const response = await request(app.getHttpServer())
      .get(`/sequences?clientId=${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const row = response.body.find((r: { id: string }) => r.id === sequenceId);
    expect(row).toBeTruthy();
    expect(row.prospectCount).toBe(2);
    expect(row.sentStep1).toBe(2);
    expect(row.sentStep2).toBe(2);
    expect(row.sentStep3).toBe(0);
    expect(row.repliedCount).toBe(1);
    expect(row.executiveName).toContain('Ejecutiva Monitor');
  });

  it('filters the list by executiveId and by search', async () => {
    const byExecutive = await request(app.getHttpServer())
      .get(`/sequences?executiveId=${executive.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byExecutive.body.some((r: { id: string }) => r.id === sequenceId)).toBe(true);

    const bySearch = await request(app.getHttpServer())
      .get('/sequences?search=Monitor E2E')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bySearch.body.some((r: { id: string }) => r.id === sequenceId)).toBe(true);

    const byUnrelatedSearch = await request(app.getHttpServer())
      .get('/sequences?search=no-existe-esto')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byUnrelatedSearch.body.some((r: { id: string }) => r.id === sequenceId)).toBe(false);
  });

  it('returns full monitor detail with resumen/resultados/events/steps', async () => {
    const response = await request(app.getHttpServer())
      .get(`/sequences/${sequenceId}/monitor`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.results.prospectCount).toBe(2);
    expect(response.body.results.repliedCount).toBe(1);
    expect(response.body.steps).toHaveLength(3);
    expect(response.body.steps[0].isSentSnapshot).toBe(true);
    expect(response.body.events.some((e: { type: string }) => e.type === 'contact.replied')).toBe(true);
    expect(response.body.events.some((e: { type: string }) => e.type === 'sequence.create')).toBe(true);
  });

  it('cancels every pending (not-yet-sent) job for the sequence', async () => {
    const response = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/cancel-pending-sends`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(201);
    expect(response.body.cancelledJobs).toBeGreaterThan(0);

    const again = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/cancel-pending-sends`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(again.body.cancelledJobs).toBe(0);
  });

  it('admin can list and retire a prospect from another executive\'s sequence', async () => {
    const list = await request(app.getHttpServer())
      .get(`/sequences/${sequenceId}/contacts`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);

    const contactToRemove = list.body[0];
    const removed = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/contacts/${contactToRemove.id}/remove`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Retiro administrativo E2E' });

    expect(removed.status).toBe(201);
    expect(removed.body.contact.status).toBe('REMOVED');
  });

  it('an executive without sequences.read_all cannot access the global list or detail', async () => {
    const list = await request(app.getHttpServer())
      .get('/sequences')
      .set('Authorization', `Bearer ${executive.token}`);
    const detail = await request(app.getHttpServer())
      .get(`/sequences/${sequenceId}/monitor`)
      .set('Authorization', `Bearer ${executive.token}`);

    expect(list.status).toBe(403);
    expect(detail.status).toBe(403);
  });

  it('an executive without sequences.cancel cannot cancel pending sends', async () => {
    const response = await request(app.getHttpServer())
      .post(`/sequences/${sequenceId}/cancel-pending-sends`)
      .set('Authorization', `Bearer ${executive.token}`);

    expect(response.status).toBe(403);
  });

  it('returns 404 (not 403) for a sequence id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/sequences/00000000-0000-0000-0000-000000000000/monitor')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
