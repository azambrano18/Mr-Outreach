import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive, linkClientMailbox, ReadyExecutive } from './fixtures';

/**
 * Spec §3 — the admin can create a sequence and assign it to any ACTIVE
 * executive (distinct from the admin, who is only ever `createdBy`), and
 * later reassign which executive operationally owns it. Covers exactly the
 * validation rules from the spec: executive must be ACTIVE and assigned to
 * the chosen client (visibility); the sender mailbox must already be
 * assigned to that executive UNLESS the admin explicitly authorizes the
 * assignment as part of the same call (operation).
 */
describe('Admin sequence creation + reassignment (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveRoleId: string;
  let seedExecutive: ReadyExecutive;
  const stamp = Date.now();

  async function loginAs(email: string, password: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return response.body.accessToken as string;
  }

  // A ManagedClient only exists via mailbox-link token redemption now — this
  // wraps that flow with a throwaway `seedExecutive` as primaryExecutiveId
  // (never the test's own executive) so it never pollutes the specific
  // client/mailbox assignments each test actually exercises.
  async function createClient(name: string): Promise<string> {
    const { clientId } = await linkClientMailbox(app, adminToken, seedExecutive.id, { clientName: name });
    return clientId;
  }

  async function assignExecutiveToClient(clientId: string, executiveId: string): Promise<void> {
    await request(app.getHttpServer())
      .put(`/clients/${clientId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });
  }

  async function createMailboxForClient(
    clientId: string,
    domainName: string,
    email: string,
  ): Promise<{ mailboxId: string; domainId: string }> {
    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName });

    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Cuenta E2E',
        email,
        fromName: 'Equipo E2E',
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
    const mailboxId = mailbox.body.id;

    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });

    // The wizard only accepts mailboxes that are actually linked and error-free
    // (spec §1.1 paso 3) — provision + advance so connectionStatus/provisioningStatus
    // are CONNECTED/PROVISIONED, same flow covered in mailbox-provisioning.e2e-spec.ts.
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/provision/advance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'ALL' });

    return { mailboxId, domainId: domain.body.id };
  }

  async function assignMailboxToExecutive(mailboxId: string, executiveId: string): Promise<void> {
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executiveId, secondaryUserIds: [] });
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await loginAs(process.env.DEV_ADMIN_EMAIL as string, process.env.DEV_ADMIN_PASSWORD as string);

    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;

    seedExecutive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Semilla Fixture',
      email: `admin-seq-seed.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin creates a wizard sequence for a different executive, already assigned to the client and mailbox', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Asignada',
      email: `admin-seq-a.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard A E2E');
    await assignExecutiveToClient(clientId, executive.id);
    const { mailboxId, domainId } = await createMailboxForClient(
      clientId,
      `admin-wizard-a-${stamp}.test`,
      `ventas.admin.a.${stamp}@example.com`,
    );
    await assignMailboxToExecutive(mailboxId, executive.id);

    const response = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });

    expect(response.status).toBe(201);
    expect(response.body.executiveId).toBe(executive.id);
    expect(response.body.createdBy).not.toBe(executive.id);
    expect(response.body.stepCount).toBe(3);

    // The sequence must be visible from the executive's own list too.
    const own = await request(app.getHttpServer())
      .get('/me/sequences')
      .set('Authorization', `Bearer ${executive.token}`);
    expect(own.body.map((s: { id: string }) => s.id)).toContain(response.body.id);
  });

  it('rejects creation when the target executive is not assigned to the chosen client', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Sin Cliente',
      email: `admin-seq-b.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard B E2E');
    // Deliberately never assigned to the client.
    const { mailboxId, domainId } = await createMailboxForClient(
      clientId,
      `admin-wizard-b-${stamp}.test`,
      `ventas.admin.b.${stamp}@example.com`,
    );

    const response = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });

    expect(response.status).toBe(400);
  });

  it('rejects an unauthorized unassigned mailbox, then succeeds once explicitly authorized', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Autorizacion',
      email: `admin-seq-c.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard C E2E');
    await assignExecutiveToClient(clientId, executive.id);
    const { mailboxId, domainId } = await createMailboxForClient(
      clientId,
      `admin-wizard-c-${stamp}.test`,
      `ventas.admin.c.${stamp}@example.com`,
    );
    // Deliberately never assigned to the executive.

    const rejected = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });
    expect(rejected.status).toBe(400);

    const authorized = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03', authorizeMailboxAssignment: true });
    expect(authorized.status).toBe(201);

    const assignees = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(assignees.body.map((a: { id: string }) => a.id)).toContain(executive.id);
  });

  it('rejects targeting an inactive executive', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Inactiva',
      email: `admin-seq-d.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard D E2E');
    await assignExecutiveToClient(clientId, executive.id);
    const { mailboxId, domainId } = await createMailboxForClient(
      clientId,
      `admin-wizard-d-${stamp}.test`,
      `ventas.admin.d.${stamp}@example.com`,
    );
    await assignMailboxToExecutive(mailboxId, executive.id);
    await request(app.getHttpServer())
      .post(`/users/${executive.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    const response = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });

    expect(response.status).toBe(400);
  });

  it('rejects creation when the client is not ACTIVE', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Cliente Inactivo',
      email: `admin-seq-f.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard F E2E');
    await assignExecutiveToClient(clientId, executive.id);
    const { mailboxId, domainId } = await createMailboxForClient(
      clientId,
      `admin-wizard-f-${stamp}.test`,
      `ventas.admin.f.${stamp}@example.com`,
    );
    await assignMailboxToExecutive(mailboxId, executive.id);
    await request(app.getHttpServer())
      .patch(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' });

    const response = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });

    expect(response.status).toBe(400);
  });

  it('rejects creation when the domain is not ACTIVE', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Dominio Inactivo',
      email: `admin-seq-g.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard G E2E');
    await assignExecutiveToClient(clientId, executive.id);
    const { mailboxId, domainId } = await createMailboxForClient(
      clientId,
      `admin-wizard-g-${stamp}.test`,
      `ventas.admin.g.${stamp}@example.com`,
    );
    await assignMailboxToExecutive(mailboxId, executive.id);
    await request(app.getHttpServer())
      .patch(`/domains/${domainId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' });

    const response = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });

    expect(response.status).toBe(400);
  });

  it('rejects creation when the mailbox belongs to a different domain than the one indicated', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Dominio Cruzado',
      email: `admin-seq-h.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard H E2E');
    await assignExecutiveToClient(clientId, executive.id);
    const { mailboxId } = await createMailboxForClient(
      clientId,
      `admin-wizard-h-${stamp}.test`,
      `ventas.admin.h.${stamp}@example.com`,
    );
    const { domainId: otherDomainId } = await createMailboxForClient(
      clientId,
      `admin-wizard-h-other-${stamp}.test`,
      `ventas.admin.h.other.${stamp}@example.com`,
    );
    await assignMailboxToExecutive(mailboxId, executive.id);

    const response = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId: otherDomainId, mailboxId, managementDate: '2026-08-03' });

    expect(response.status).toBe(400);
  });

  it('rejects creation when the mailbox is not linked/connected (never provisioned)', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Cuenta Sin Vincular',
      email: `admin-seq-i.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard I E2E');
    await assignExecutiveToClient(clientId, executive.id);
    const domainName = `admin-wizard-i-${stamp}.test`;
    const domain = await request(app.getHttpServer())
      .post(`/clients/${clientId}/domains`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainName });
    const email = `ventas.admin.i.${stamp}@example.com`;
    const mailbox = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Cuenta E2E Sin Vincular',
        email,
        fromName: 'Equipo E2E',
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
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailbox.body.id}/link-domain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domainId: domain.body.id });
    // Deliberately never provisioned/advanced — connectionStatus stays NOT_TESTED.
    await assignMailboxToExecutive(mailbox.body.id, executive.id);

    const response = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clientId, domainId: domain.body.id, mailboxId: mailbox.body.id, managementDate: '2026-08-03' });

    // Fase 2 — SequenceEligibilityService reports "cuenta no elegible" as 409
    // (a conflict with the account's current state), not 400, per the
    // Fase 2 spec's error-code table — a deliberate change from this
    // check's previous ad hoc 400.
    expect(response.status).toBe(409);
  });

  it('an executive without sequences.assign cannot use the admin wizard endpoint', async () => {
    const executive = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Sin Permiso',
      email: `admin-seq-e.${stamp}@mejoreferido.cl`,
      roleId: executiveRoleId,
    });
    const clientId = await createClient('Cliente Admin Wizard E E2E');
    await assignExecutiveToClient(clientId, executive.id);
    const { mailboxId, domainId } = await createMailboxForClient(
      clientId,
      `admin-wizard-e-${stamp}.test`,
      `ventas.admin.e.${stamp}@example.com`,
    );
    await assignMailboxToExecutive(mailboxId, executive.id);

    const response = await request(app.getHttpServer())
      .post(`/users/${executive.id}/sequences/wizard`)
      .set('Authorization', `Bearer ${executive.token}`)
      .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });

    expect(response.status).toBe(403);
  });

  describe('reassignExecutive', () => {
    it('reassigns operational ownership to a different executive assigned to the same client, keeping createdBy unchanged', async () => {
      const originalExecutive = await createReadyExecutive(app, adminToken, {
        name: 'Ejecutiva Original',
        email: `admin-reassign-a.${stamp}@mejoreferido.cl`,
        roleId: executiveRoleId,
      });
      const newExecutive = await createReadyExecutive(app, adminToken, {
        name: 'Ejecutiva Nueva',
        email: `admin-reassign-b.${stamp}@mejoreferido.cl`,
        roleId: executiveRoleId,
      });
      const clientId = await createClient('Cliente Reasignacion E2E');
      await request(app.getHttpServer())
        .put(`/clients/${clientId}/assignees`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ primaryUserId: originalExecutive.id, secondaryUserIds: [newExecutive.id] });
      const { mailboxId, domainId } = await createMailboxForClient(
        clientId,
        `admin-reassign-${stamp}.test`,
        `ventas.reassign.${stamp}@example.com`,
      );
      await assignMailboxToExecutive(mailboxId, originalExecutive.id);

      const created = await request(app.getHttpServer())
        .post(`/users/${originalExecutive.id}/sequences/wizard`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });
      expect(created.status).toBe(201);
      const sequenceId = created.body.id;
      const createdBy = created.body.createdBy;

      const reassigned = await request(app.getHttpServer())
        .patch(`/sequences/${sequenceId}/reassign-executive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ executiveId: newExecutive.id, reason: 'Reorganización de cartera' });

      expect(reassigned.status).toBe(200);
      expect(reassigned.body.executiveId).toBe(newExecutive.id);
      expect(reassigned.body.createdBy).toBe(createdBy);

      const newExecutiveList = await request(app.getHttpServer())
        .get('/me/sequences')
        .set('Authorization', `Bearer ${newExecutive.token}`);
      expect(newExecutiveList.body.map((s: { id: string }) => s.id)).toContain(sequenceId);

      const originalExecutiveList = await request(app.getHttpServer())
        .get('/me/sequences')
        .set('Authorization', `Bearer ${originalExecutive.token}`);
      expect(originalExecutiveList.body.map((s: { id: string }) => s.id)).not.toContain(sequenceId);
    });

    it('rejects reassigning to an executive not assigned to the sequence client', async () => {
      const originalExecutive = await createReadyExecutive(app, adminToken, {
        name: 'Ejecutiva Original 2',
        email: `admin-reassign-c.${stamp}@mejoreferido.cl`,
        roleId: executiveRoleId,
      });
      const outsiderExecutive = await createReadyExecutive(app, adminToken, {
        name: 'Ejecutiva Ajena',
        email: `admin-reassign-d.${stamp}@mejoreferido.cl`,
        roleId: executiveRoleId,
      });
      const clientId = await createClient('Cliente Reasignacion Rechazo E2E');
      await assignExecutiveToClient(clientId, originalExecutive.id);
      const { mailboxId, domainId } = await createMailboxForClient(
        clientId,
        `admin-reassign-reject-${stamp}.test`,
        `ventas.reassign.reject.${stamp}@example.com`,
      );
      await assignMailboxToExecutive(mailboxId, originalExecutive.id);

      const created = await request(app.getHttpServer())
        .post(`/users/${originalExecutive.id}/sequences/wizard`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });

      const response = await request(app.getHttpServer())
        .patch(`/sequences/${created.body.id}/reassign-executive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ executiveId: outsiderExecutive.id });

      expect(response.status).toBe(400);
    });

    it('an executive without sequences.reassign cannot reassign a sequence', async () => {
      const originalExecutive = await createReadyExecutive(app, adminToken, {
        name: 'Ejecutiva Original 3',
        email: `admin-reassign-e.${stamp}@mejoreferido.cl`,
        roleId: executiveRoleId,
      });
      const clientId = await createClient('Cliente Reasignacion Permiso E2E');
      await assignExecutiveToClient(clientId, originalExecutive.id);
      const { mailboxId, domainId } = await createMailboxForClient(
        clientId,
        `admin-reassign-perm-${stamp}.test`,
        `ventas.reassign.perm.${stamp}@example.com`,
      );
      await assignMailboxToExecutive(mailboxId, originalExecutive.id);

      const created = await request(app.getHttpServer())
        .post(`/users/${originalExecutive.id}/sequences/wizard`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ clientId, domainId, mailboxId, managementDate: '2026-08-03' });

      const response = await request(app.getHttpServer())
        .patch(`/sequences/${created.body.id}/reassign-executive`)
        .set('Authorization', `Bearer ${originalExecutive.token}`)
        .send({ executiveId: originalExecutive.id });

      expect(response.status).toBe(403);
    });
  });
});
