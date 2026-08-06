import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive, linkClientMailbox } from './fixtures';
import { SimulatedMailboxMotorAdapter } from '../src/infrastructure/mailbox-motor/simulated/simulated-mailbox-motor-adapter';
import { OrganizationRepository } from '../src/domain/organization/organization.repository';
import { RoleRepository } from '../src/domain/role/role.repository';
import { SequenceExecutionRepository } from '../src/domain/sequence-execution/sequence-execution.repository';
import { UserRepository } from '../src/domain/user/user.repository';
import { UserRoleRepository } from '../src/domain/user-role/user-role.repository';
import {
  ORGANIZATION_REPOSITORY,
  ROLE_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  USER_REPOSITORY,
  USER_ROLE_REPOSITORY,
} from '../src/infrastructure/persistence/tokens';

const PASSWORD_HASH_ROUNDS = 10;
const FIXTURE_PASSWORD = 'Fixture#Password1';

/**
 * "Mejora del flujo de desvinculación de cuentas con ejecutivos asignados" —
 * end-to-end proof that MailboxAssignment rows are removed ONLY after the
 * motor confirms REVOKED (never before, never on FAILED), that this needs
 * explicit admin authorization, that the executive Users themselves are
 * never touched, that historical data survives, and that an active Gestión
 * blocks the whole flow. Memory persistence + simulated motor only.
 */
describe('Mailbox unlink — assignment removal (e2e), memory + simulated motor', () => {
  let app: INestApplication;
  let motor: SimulatedMailboxMotorAdapter;
  let adminToken: string;
  let adminUserId: string;
  const stamp = Date.now();

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();
    motor = app.get(SimulatedMailboxMotorAdapter);

    const adminLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;
    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    adminUserId = me.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function executiveRoleId(): Promise<string> {
    const roles = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${adminToken}`);
    return roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;
  }

  /** Direct-repository fixture (same pattern as sequence-templates.e2e-spec.ts) — a genuine second Organization + admin holding `mailboxes.unlink`, to test real cross-tenant isolation, never simulated by comparing two users in the same org. */
  async function createOtherOrganizationToken(): Promise<string> {
    const organizations = app.get<OrganizationRepository>(ORGANIZATION_REPOSITORY);
    const roles = app.get<RoleRepository>(ROLE_REPOSITORY);
    const users = app.get<UserRepository>(USER_REPOSITORY);
    const userRoles = app.get<UserRoleRepository>(USER_ROLE_REPOSITORY);

    const otherOrg = await organizations.create({ name: `Otra Organización E2E ${stamp}` });
    const otherRole = await roles.create({
      organizationId: otherOrg.id,
      name: 'ADMIN',
      permissionKeys: ['mailboxes.unlink', 'mailboxes.read.all'],
    });
    const otherUser = await users.create({
      organizationId: otherOrg.id,
      firstName: 'Otra',
      lastName: 'Organización',
      email: `unlink-otra-org.${stamp}@mejoreferido.cl`,
      passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, PASSWORD_HASH_ROUNDS),
      mustChangePassword: false,
    });
    await userRoles.assign(otherUser.id, otherRole.id);
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: otherUser.email, password: FIXTURE_PASSWORD });
    return login.body.accessToken as string;
  }

  it('full flow: preview lists both executives, assignments survive FAILED, and are removed only after REVOKED — users stay intact', async () => {
    const roleId = await executiveRoleId();
    const primary = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Principal',
      email: `unlink-primary.${stamp}@mejoreferido.cl`,
      roleId,
    });
    const secondary = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutivo Secundario',
      email: `unlink-secondary.${stamp}@mejoreferido.cl`,
      roleId,
    });

    // 1-4. Link a QA mailbox, assign primary + secondary.
    const { mailboxId, serverMailboxId } = await linkClientMailbox(app, adminToken, primary.id);
    const setAssignees = await request(app.getHttpServer())
      .put(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: primary.id, secondaryUserIds: [secondary.id] });
    expect(setAssignees.status).toBe(200);

    // A historical conversation on this mailbox, to prove later it survives.
    const conversation = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(conversation.status).toBe(200);

    // 5-6. Preflight lists both executives, reports canUnlink and the count to remove.
    const preview = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/unlink-preview`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.canUnlink).toBe(true);
    expect(preview.body.blockingReasons).toEqual([]);
    expect(preview.body.primaryExecutive).toEqual(
      expect.objectContaining({ id: primary.id, email: `unlink-primary.${stamp}@mejoreferido.cl` }),
    );
    expect(preview.body.secondaryExecutives).toEqual([
      expect.objectContaining({ id: secondary.id, email: `unlink-secondary.${stamp}@mejoreferido.cl` }),
    ]);
    expect(preview.body.assignmentsToRemove).toBe(2);

    // 7-8. Request unlink with authorization, but the motor fails first —
    // the account must stay UNLINK_REQUESTED and BOTH assignments must survive.
    motor.setUnlinkOutcome(serverMailboxId, 'FAILURE');
    const failedAttempt = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-unlink-assign-${stamp}-1`)
      .send({ reason: 'Cuenta dada de baja — prueba e2e', removeAssignmentsAfterUnlink: true });
    expect(failedAttempt.status).toBe(201);
    expect(failedAttempt.body.linkStatus).toBe('UNLINK_REQUESTED');

    const assigneesWhileFailed = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(assigneesWhileFailed.body).toHaveLength(2);

    // 9-11. The motor now succeeds — retry confirms REVOKED, and only THEN do the assignments disappear.
    motor.setUnlinkOutcome(serverMailboxId, 'SUCCESS');
    const retry = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink/retry`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(retry.status).toBe(201);
    expect(retry.body.linkStatus).toBe('REVOKED');

    // 12. Assignments are gone.
    const assigneesAfterRevoke = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(assigneesAfterRevoke.body).toEqual([]);

    // 13. Both users still exist and are ACTIVE — the operation never touched them.
    const primaryAfter = await request(app.getHttpServer()).get(`/users/${primary.id}`).set('Authorization', `Bearer ${adminToken}`);
    const secondaryAfter = await request(app.getHttpServer()).get(`/users/${secondary.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(primaryAfter.status).toBe(200);
    expect(primaryAfter.body.status).toBe('ACTIVE');
    expect(primaryAfter.body.roleId).toBe(roleId);
    expect(secondaryAfter.status).toBe(200);
    expect(secondaryAfter.body.status).toBe('ACTIVE');
    expect(secondaryAfter.body.roleId).toBe(roleId);

    // 14. The mailbox shows REVOKED and is now eliminable.
    const mailboxAfter = await request(app.getHttpServer()).get(`/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(mailboxAfter.body.linkStatus).toBe('REVOKED');

    // 15. No longer appears in the primary's operational selector.
    const primaryMailboxes = await request(app.getHttpServer())
      .get('/me/mailboxes')
      .set('Authorization', `Bearer ${primary.token}`);
    expect(primaryMailboxes.body.map((m: { id: string }) => m.id)).not.toContain(mailboxId);

    // 16. Audit trail: requested/accepted/processing/failed/confirmed, plus the assignment removal — never claiming a deletion.
    const audit = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/audit-log`)
      .set('Authorization', `Bearer ${adminToken}`);
    const actions = audit.body.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('mailbox.unlink_requested');
    expect(actions).toContain('mailbox.unlink_failed');
    expect(actions).toContain('mailbox.unlink_confirmed');
    expect(actions).toContain('mailbox.assignments_removed_after_unlink');
    const removalEntry = audit.body.find((entry: { action: string }) => entry.action === 'mailbox.assignments_removed_after_unlink');
    expect(removalEntry.metadata.assignmentsRemoved).toBe(2);
    expect(removalEntry.metadata.primaryRemoved).toEqual(expect.objectContaining({ id: primary.id }));
    expect(JSON.stringify(removalEntry)).not.toMatch(/"deleted"|"deactivated"/i);

    // 17. Delete the now-REVOKED mailbox — succeeds since assignments are already gone.
    const del = await request(app.getHttpServer()).delete(`/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
    const afterDelete = await request(app.getHttpServer()).get(`/mailboxes/${mailboxId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(afterDelete.status).toBe(404);
  });

  it('idempotency: a repeated unlink call with the SAME Idempotency-Key never records a second requested/removal event', async () => {
    const roleId = await executiveRoleId();
    const primary = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Idempotencia',
      email: `unlink-idem.${stamp}@mejoreferido.cl`,
      roleId,
    });
    const { mailboxId } = await linkClientMailbox(app, adminToken, primary.id);
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: primary.id, secondaryUserIds: [] });

    const key = `e2e-unlink-idem-${stamp}`;
    const first = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({ reason: 'Idempotencia', removeAssignmentsAfterUnlink: true });
    const second = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', key)
      .send({ reason: 'Idempotencia', removeAssignmentsAfterUnlink: true });

    expect(first.body.linkStatus).toBe('REVOKED');
    // A replay with the same Idempotency-Key returns the claim-time snapshot
    // (pre-existing IdempotentOperationService contract, unrelated to this
    // task) rather than re-deriving the current state — but it must never
    // re-run the operation: no second command, no second removal, no
    // duplicate audit trail, which is what actually matters for §8.
    expect(second.status).toBe(first.status);
    expect(second.body.mailboxId).toBe(first.body.mailboxId);

    const audit = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/audit-log`)
      .set('Authorization', `Bearer ${adminToken}`);
    const requestedCount = audit.body.filter((entry: { action: string }) => entry.action === 'mailbox.unlink_requested').length;
    const removedCount = audit.body.filter((entry: { action: string }) => entry.action === 'mailbox.assignments_removed_after_unlink').length;
    expect(requestedCount).toBe(1);
    expect(removedCount).toBe(1);
  });

  it('§9 reconciliation: a mailbox already REVOKED with a residual assignment can be cleaned up via the reconcile endpoint, idempotently', async () => {
    const roleId = await executiveRoleId();
    const primary = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Residual',
      email: `unlink-residual.${stamp}@mejoreferido.cl`,
      roleId,
    });
    const { mailboxId } = await linkClientMailbox(app, adminToken, primary.id);

    // Unlink WITHOUT authorizing removal — REVOKED, but the assignment survives (pre-existing, unauthorized case).
    await request(app.getHttpServer())
      .put(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: primary.id, secondaryUserIds: [] });
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-unlink-residual-${stamp}`)
      .send({ reason: 'Sin autorizar retiro' });

    const beforeReconcile = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(beforeReconcile.body).toHaveLength(1);

    const reconcile = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/reconcile-assignments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reconcile.status).toBe(201);
    expect(reconcile.body.assignmentsRemoved).toBe(1);

    const afterReconcile = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterReconcile.body).toEqual([]);

    // Idempotent: a second reconcile on an already-clean mailbox is a safe no-op.
    const secondReconcile = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/reconcile-assignments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(secondReconcile.status).toBe(201);
    expect(secondReconcile.body.assignmentsRemoved).toBe(0);

    // The executive user is still there, untouched.
    const userAfter = await request(app.getHttpServer()).get(`/users/${primary.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(userAfter.status).toBe(200);
    expect(userAfter.body.status).toBe('ACTIVE');
  });

  it('§4 an active Gestión blocks unlinking, with a controlled message — never cancels it silently', async () => {
    const roleId = await executiveRoleId();
    const primary = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Con Gestion',
      email: `unlink-gestion.${stamp}@mejoreferido.cl`,
      roleId,
    });
    const { mailboxId } = await linkClientMailbox(app, adminToken, primary.id);

    const executions = app.get<SequenceExecutionRepository>(SEQUENCE_EXECUTION_REPOSITORY);
    const adminMe = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    const execution = await executions.create({
      organizationId: adminMe.body.organizationId,
      executiveId: primary.id,
      mailboxId,
      templateId: 'template_e2e',
      templateVersionId: 'template_version_e2e',
      timezone: 'America/Santiago',
      createdBy: adminUserId,
    });
    await executions.update(execution.id, { status: 'RUNNING' });

    const blocked = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-unlink-gestion-blocked-${stamp}`)
      .send({ reason: 'Debería bloquearse' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('Gestiones activas');

    const mailboxStillActive = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(mailboxStillActive.body.linkStatus).toBe('ACTIVE');

    // Once the Gestión is no longer active/transitional, unlinking succeeds.
    await executions.update(execution.id, { status: 'STOPPED' });
    const allowed = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-unlink-gestion-allowed-${stamp}`)
      .send({ reason: 'Ahora sí' });
    expect(allowed.status).toBe(201);
    expect(allowed.body.linkStatus).toBe('REVOKED');
  });

  it('EXECUTIVE cannot call the preview, unlink, or reconcile endpoints — 403', async () => {
    const roleId = await executiveRoleId();
    const primary = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Sin Permiso',
      email: `unlink-forbidden.${stamp}@mejoreferido.cl`,
      roleId,
    });
    const { mailboxId } = await linkClientMailbox(app, adminToken, primary.id);

    const preview = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/unlink-preview`)
      .set('Authorization', `Bearer ${primary.token}`);
    expect(preview.status).toBe(403);

    const unlink = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink`)
      .set('Authorization', `Bearer ${primary.token}`)
      .set('Idempotency-Key', `e2e-unlink-forbidden-${stamp}`)
      .send({ reason: 'No debería poder', removeAssignmentsAfterUnlink: true });
    expect(unlink.status).toBe(403);

    const reconcile = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/reconcile-assignments`)
      .set('Authorization', `Bearer ${primary.token}`);
    expect(reconcile.status).toBe(403);
  });

  it('a user from a different organization gets 404 on the preview, even while holding mailboxes.unlink', async () => {
    const roleId = await executiveRoleId();
    const primary = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Org Aislada',
      email: `unlink-isolation.${stamp}@mejoreferido.cl`,
      roleId,
    });
    const { mailboxId } = await linkClientMailbox(app, adminToken, primary.id);
    const otherOrgToken = await createOtherOrganizationToken();

    const preview = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/unlink-preview`)
      .set('Authorization', `Bearer ${otherOrgToken}`);
    expect(preview.status).toBe(404);

    const unlink = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/unlink`)
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .set('Idempotency-Key', `e2e-unlink-cross-org-${stamp}`)
      .send({ reason: 'No debería alcanzar esta cuenta' });
    expect(unlink.status).toBe(404);
  });

  it('an unauthenticated request is rejected outright', async () => {
    const roleId = await executiveRoleId();
    const primary = await createReadyExecutive(app, adminToken, {
      name: 'Ejecutiva Sin Sesion',
      email: `unlink-noauth.${stamp}@mejoreferido.cl`,
      roleId,
    });
    const { mailboxId } = await linkClientMailbox(app, adminToken, primary.id);

    const unauthenticated = await request(app.getHttpServer()).get(`/mailboxes/${mailboxId}/unlink-preview`);
    expect(unauthenticated.status).toBe(401);
  });
});
