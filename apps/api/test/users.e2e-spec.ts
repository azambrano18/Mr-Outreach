import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { createReadyExecutive } from './fixtures';

describe('Users (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;
  let executiveRoleId: string;
  let adminRoleId: string;
  let adminUserId: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const executiveLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: executiveEmail, password: executivePassword });
    executiveToken = executiveLogin.body.accessToken;

    const roles = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${adminToken}`);
    executiveRoleId = roles.body.find((role: { name: string }) => role.name === 'EXECUTIVE').id;
    adminRoleId = roles.body.find((role: { name: string }) => role.name === 'ADMIN').id;

    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    adminUserId = me.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('an executive (no users.* permission) is forbidden from listing or creating users', async () => {
    const list = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${executiveToken}`);
    const create = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({
        firstName: 'X',
        lastName: 'Usuario',
        email: 'x.usuario@mejoreferido.cl',
        roleId: executiveRoleId,
      });

    expect(list.status).toBe(403);
    expect(create.status).toBe(403);
  });

  it('rejects a non-institutional email on create, both obviously-external and look-alike domains', async () => {
    const externalDomains = ['nuevo.ejecutivo@gmail.com', 'nuevo.ejecutivo@cliente.cl', 'nuevo.ejecutivo@mejoreferido.com'];
    for (const email of externalDomains) {
      const response = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Nuevo', lastName: 'Ejecutivo', email, roleId: executiveRoleId });

      expect(response.status).toBe(400);
    }
  });

  it('admin creates a new executive with a generated one-time password, sees it in the list, and it can log in', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Nuevo',
        lastName: 'Ejecutivo',
        email: '  Nuevo.Ejecutivo@MejoReferido.CL  ',
        roleId: executiveRoleId,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.roleName).toBe('EXECUTIVE');
    expect(createResponse.body).not.toHaveProperty('passwordHash');
    expect(createResponse.body.email).toBe('nuevo.ejecutivo@mejoreferido.cl'); // normalized
    expect(createResponse.body.mustChangePassword).toBe(true);
    const temporaryPassword: string = createResponse.body.temporaryPassword;
    expect(typeof temporaryPassword).toBe('string');
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);

    const listResponse = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.body.map((u: { email: string }) => u.email)).toContain(
      'nuevo.ejecutivo@mejoreferido.cl',
    );
    // The temporary password must never resurface in any subsequent read.
    expect(JSON.stringify(listResponse.body)).not.toContain(temporaryPassword);

    const newUserLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nuevo.ejecutivo@mejoreferido.cl', password: temporaryPassword });
    expect(newUserLogin.status).toBe(200);
    expect(newUserLogin.body.user.mustChangePassword).toBe(true);
  });

  it("a freshly created executive is blocked from every other endpoint until they change their password, then unblocked", async () => {
    const created = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Forzado', lastName: 'Cambio', email: 'forzado.cambio@mejoreferido.cl', roleId: executiveRoleId });
    const temporaryPassword: string = created.body.temporaryPassword;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'forzado.cambio@mejoreferido.cl', password: temporaryPassword });
    const freshToken = login.body.accessToken;

    const blocked = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(blocked.status).toBe(403);

    // /auth/me and /auth/logout stay reachable even mid-forced-change.
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(true);

    const wrongCurrent = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ currentPassword: 'not-the-real-one', newPassword: 'BrandNewPass1' });
    expect(wrongCurrent.status).toBe(401);

    const changed = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ currentPassword: temporaryPassword, newPassword: 'BrandNewPass1' });
    expect(changed.status).toBe(200);

    const unblocked = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(unblocked.body.mustChangePassword).toBe(false);

    const oldPasswordLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'forzado.cambio@mejoreferido.cl', password: temporaryPassword });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'forzado.cambio@mejoreferido.cl', password: 'BrandNewPass1' });
    expect(newPasswordLogin.status).toBe(200);
  });

  it('admin resets an executive password: invalidates the old one, forces mustChangePassword again, and audits', async () => {
    const { id, token } = await createReadyExecutive(app, adminToken, {
      name: 'Sera Reseteado',
      email: 'sera.reseteado@mejoreferido.cl',
      roleId: executiveRoleId,
    });

    const meBeforeReset = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meBeforeReset.body.mustChangePassword).toBe(false);

    const reset = await request(app.getHttpServer())
      .post(`/users/${id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reset.status).toBe(201);
    expect(reset.body.email).toBe('sera.reseteado@mejoreferido.cl');
    const newTemporaryPassword: string = reset.body.temporaryPassword;
    expect(typeof newTemporaryPassword).toBe('string');

    const loginWithOldToken = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${token}`);
    expect(loginWithOldToken.status).toBe(403); // mustChangePassword is true again

    const loginWithNewPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'sera.reseteado@mejoreferido.cl', password: newTemporaryPassword });
    expect(loginWithNewPassword.status).toBe(200);
    expect(loginWithNewPassword.body.user.mustChangePassword).toBe(true);
  });

  it("admin edits the executive's name", async () => {
    const created = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Nombre',
        lastName: 'Original',
        email: 'editable@mejoreferido.cl',
        roleId: executiveRoleId,
      });

    const updated = await request(app.getHttpServer())
      .patch(`/users/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Nombre', lastName: 'Actualizado' });

    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Nombre Actualizado');
    expect(updated.body.email).toBe('editable@mejoreferido.cl');
  });

  it('deactivating an executive immediately blocks login, reactivating restores it', async () => {
    const created = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Sera',
        lastName: 'Desactivado',
        email: 'desactivar@mejoreferido.cl',
        roleId: executiveRoleId,
      });
    const temporaryPassword: string = created.body.temporaryPassword;

    const deactivate = await request(app.getHttpServer())
      .post(`/users/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivate.status).toBe(201);
    expect(deactivate.body.status).toBe('INACTIVE');

    const blockedLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'desactivar@mejoreferido.cl', password: temporaryPassword });
    expect(blockedLogin.status).toBe(401);

    const reactivate = await request(app.getHttpServer())
      .post(`/users/${created.body.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivate.body.status).toBe('ACTIVE');

    const restoredLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'desactivar@mejoreferido.cl', password: temporaryPassword });
    expect(restoredLogin.status).toBe(200);
  });

  it('an admin can create a new user with the ADMIN role id — the create-user flow allows both ADMIN and EXECUTIVE', async () => {
    const response = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Nueva',
        lastName: 'Admin',
        email: 'nueva.admin@mejoreferido.cl',
        roleId: adminRoleId,
      });

    expect(response.status).toBe(201);
    expect(response.body.roleName).toBe('ADMIN');
    const listResponse = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.body.map((u: { email: string }) => u.email)).toContain('nueva.admin@mejoreferido.cl');
  });

  it('rejects creating a user with a role id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Invalido',
        lastName: 'Usuario',
        email: 'invalido@mejoreferido.cl',
        roleId: 'role_does_not_exist',
      });

    expect(response.status).toBe(400);
  });

  it('returns 404 (not 403) for a user id that does not exist, keeping tenant existence private', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  describe('DELETE /users/:id', () => {
    it('an executive (no users.delete permission) cannot delete a user', async () => {
      const { id } = await createReadyExecutive(app, adminToken, {
        name: 'Sera Protegido',
        email: 'sera.protegido@mejoreferido.cl',
        roleId: executiveRoleId,
      });

      const response = await request(app.getHttpServer())
        .delete(`/users/${id}`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });

    it('rejects deactivating an admin when it would leave the organization with zero active admins', async () => {
      // Deactivate every OTHER admin first so `adminUserId` becomes the last one standing.
      const roster = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${adminToken}`);
      const otherActiveAdmins = roster.body.filter(
        (u: { id: string; roleName: string; status: string }) =>
          u.roleName === 'ADMIN' && u.status === 'ACTIVE' && u.id !== adminUserId,
      );
      for (const other of otherActiveAdmins) {
        await request(app.getHttpServer())
          .post(`/users/${other.id}/deactivate`)
          .set('Authorization', `Bearer ${adminToken}`);
      }

      const response = await request(app.getHttpServer())
        .post(`/users/${adminUserId}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/último administrador/);

      const stillActive = await request(app.getHttpServer())
        .get(`/users/${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(stillActive.body.status).toBe('ACTIVE');
    });

    it('rejects deleting a user who is still ACTIVE, with a controlled domain error naming the required step', async () => {
      const { id } = await createReadyExecutive(app, adminToken, {
        name: 'Sigue Activo',
        email: 'sigue.activo@mejoreferido.cl',
        roleId: executiveRoleId,
      });

      const response = await request(app.getHttpServer())
        .delete(`/users/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/desactivarse/);

      const stillThere = await request(app.getHttpServer())
        .get(`/users/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(stillThere.status).toBe(200);
    });

    it('an admin can delete another admin while at least one other active admin remains — once deactivated first (ACTIVE -> INACTIVE -> DELETED)', async () => {
      const created = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Otro', lastName: 'Admin', email: 'otro.admin@mejoreferido.cl', roleId: adminRoleId });

      const deactivateResponse = await request(app.getHttpServer())
        .post(`/users/${created.body.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deactivateResponse.status).toBe(201);

      const response = await request(app.getHttpServer())
        .delete(`/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(204);

      const listResponse = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listResponse.body.map((u: { email: string }) => u.email)).not.toContain('otro.admin@mejoreferido.cl');
    });

    it('an admin cannot delete their own account', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/users/${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(403);
    });

    it('rejects deleting the protected system account (sistema@mejoreferido.cl) through the API, even as a direct request', async () => {
      const created = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Sistema', lastName: 'Protegido', email: 'sistema@mejoreferido.cl', roleId: adminRoleId });
      expect(created.status).toBe(201);

      const response = await request(app.getHttpServer())
        .delete(`/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(403);

      const listResponse = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listResponse.body.map((u: { email: string }) => u.email)).toContain('sistema@mejoreferido.cl');
    });

    /**
     * Looks up the protected account created by an earlier test in this
     * file rather than creating a new one — `sistema@mejoreferido.cl` is
     * unique per organization, and this suite shares one organization
     * across every test, so a second `POST /users` with the same email
     * would 409 on the uniqueness constraint, not on anything this test
     * cares about.
     */
    async function findProtectedSystemAccountId(): Promise<string> {
      const listResponse = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${adminToken}`);
      const protectedUser = (listResponse.body as Array<{ id: string; email: string }>).find(
        (u) => u.email === 'sistema@mejoreferido.cl',
      );
      if (!protectedUser) {
        throw new Error('Expected the protected system account to already exist from an earlier test.');
      }
      return protectedUser.id;
    }

    it('rejects deactivating the protected system account through the API, even as a direct request', async () => {
      const protectedId = await findProtectedSystemAccountId();

      const response = await request(app.getHttpServer())
        .post(`/users/${protectedId}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(403);

      const stillThere = await request(app.getHttpServer())
        .get(`/users/${protectedId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(stillThere.body.status).toBe('ACTIVE');
    });

    it('rejects changing the protected system account’s email or role through the generic update endpoint, even as a direct request with a crafted payload', async () => {
      const protectedId = await findProtectedSystemAccountId();

      const emailChange = await request(app.getHttpServer())
        .patch(`/users/${protectedId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'atacante@mejoreferido.cl' });
      expect(emailChange.status).toBe(403);

      const roleChange = await request(app.getHttpServer())
        .patch(`/users/${protectedId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: executiveRoleId });
      expect(roleChange.status).toBe(403);

      const stillThere = await request(app.getHttpServer())
        .get(`/users/${protectedId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(stillThere.body.email).toBe('sistema@mejoreferido.cl');
      expect(stillThere.body.roleName).toBe('ADMIN');
    });

    it('an admin deletes an executive with no dependencies: it disappears from listings and can no longer log in', async () => {
      const created = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Sera',
          lastName: 'Eliminado',
          email: 'sera.eliminado@mejoreferido.cl',
          roleId: executiveRoleId,
        });
      const temporaryPassword: string = created.body.temporaryPassword;

      await request(app.getHttpServer())
        .post(`/users/${created.body.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteResponse.status).toBe(204);

      const getResponse = await request(app.getHttpServer())
        .get(`/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getResponse.status).toBe(404);

      const listResponse = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listResponse.body.map((u: { email: string }) => u.email)).not.toContain(
        'sera.eliminado@mejoreferido.cl',
      );

      const loginAttempt = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'sera.eliminado@mejoreferido.cl', password: temporaryPassword });
      expect(loginAttempt.status).toBe(401);
    });

    it('a second delete of the same (already-deleted) user returns a controlled 404, not a crash', async () => {
      const created = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Doble',
          lastName: 'Eliminado',
          email: 'doble.eliminado@mejoreferido.cl',
          roleId: executiveRoleId,
        });

      await request(app.getHttpServer())
        .post(`/users/${created.body.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      await request(app.getHttpServer())
        .delete(`/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const secondDelete = await request(app.getHttpServer())
        .delete(`/users/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(secondDelete.status).toBe(404);
    });
  });

  describe('GET /users/:id/deletion-impact', () => {
    it('flags mustDeactivateFirst=true and canDelete=false while the executive is still ACTIVE', async () => {
      const { id } = await createReadyExecutive(app, adminToken, {
        name: 'Todavia Activo',
        email: 'todavia.activo@mejoreferido.cl',
        roleId: executiveRoleId,
      });

      const response = await request(app.getHttpServer())
        .get(`/users/${id}/deletion-impact`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.mustDeactivateFirst).toBe(true);
      expect(response.body.canDelete).toBe(false);
    });

    it('previews zero counts and canDelete=true for a clean, already-deactivated executive', async () => {
      const { id } = await createReadyExecutive(app, adminToken, {
        name: 'Sin Dependencias',
        email: 'sin.dependencias@mejoreferido.cl',
        roleId: executiveRoleId,
      });
      await request(app.getHttpServer())
        .post(`/users/${id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      const response = await request(app.getHttpServer())
        .get(`/users/${id}/deletion-impact`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        roleName: 'EXECUTIVE',
        isProtectedSystemAccount: false,
        isSelf: false,
        mustDeactivateFirst: false,
        isLastActiveAdmin: false,
        primaryMailboxCount: 0,
        secondaryMailboxCount: 0,
        activeExecutionCount: 0,
        canDelete: true,
      });
    });

    it('flags isSelf=true and canDelete=false when previewing the caller’s own account', async () => {
      const response = await request(app.getHttpServer())
        .get(`/users/${adminUserId}/deletion-impact`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.isSelf).toBe(true);
      expect(response.body.canDelete).toBe(false);
    });

    it('an executive (no users.delete permission) cannot preview a deletion impact', async () => {
      const { id } = await createReadyExecutive(app, adminToken, {
        name: 'Sin Permiso',
        email: 'sin.permiso@mejoreferido.cl',
        roleId: executiveRoleId,
      });

      const response = await request(app.getHttpServer())
        .get(`/users/${id}/deletion-impact`)
        .set('Authorization', `Bearer ${executiveToken}`);

      expect(response.status).toBe(403);
    });
  });
});
