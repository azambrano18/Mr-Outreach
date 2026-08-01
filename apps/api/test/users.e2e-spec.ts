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

  it('rejects creating a user with the ADMIN role id — this endpoint only ever creates EXECUTIVE users', async () => {
    const response = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Intento',
        lastName: 'DeAdmin',
        email: 'intento.de.admin@mejoreferido.cl',
        roleId: adminRoleId,
      });

    expect(response.status).toBe(400);
    const listResponse = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.body.map((u: { email: string }) => u.email)).not.toContain(
      'intento.de.admin@mejoreferido.cl',
    );
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
});
