import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Variables (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  const createPayload = {
    key: 'apellido_e2e',
    label: 'Apellido del contacto',
  };

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('an executive (no variables.* permission) cannot list or create variables', async () => {
    const list = await request(app.getHttpServer())
      .get('/variables')
      .set('Authorization', `Bearer ${executiveToken}`);
    const create = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send(createPayload);

    expect(list.status).toBe(403);
    expect(create.status).toBe(403);
  });

  it('admin creates a variable with just a key and a label, defaulting to CUSTOM/ACTIVE', async () => {
    const response = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.key).toBe('apellido_e2e');
    expect(response.body.source).toBe('CUSTOM');
    expect(response.body.description).toBeNull();
  });

  it('rejects a key with invalid characters', async () => {
    const response = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, key: 'apellido invalido' });

    expect(response.status).toBe(400);
  });

  it('normalizes an uppercase/spaced key to lowercase before validating and storing it', async () => {
    const response = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, key: '  Rubro_Empresa  ' });

    expect(response.status).toBe(201);
    expect(response.body.key).toBe('rubro_empresa');
  });

  it('rejects extra fields like description/source — the form is deliberately just key + label', async () => {
    const response = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, key: 'otro_e2e', description: 'x', source: 'CONTACT' });

    expect(response.status).toBe(400);
  });

  it('rejects a duplicate key within the same organization', async () => {
    const response = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload);

    expect(response.status).toBe(409);
  });

  it('admin lists variables and sees the created one', async () => {
    const response = await request(app.getHttpServer())
      .get('/variables')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.map((v: { key: string }) => v.key)).toContain('apellido_e2e');
  });

  it('admin edits only the label, leaving the key untouched', async () => {
    const created = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, key: 'editable_e2e' });

    const updated = await request(app.getHttpServer())
      .patch(`/variables/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Etiqueta renombrada' });

    expect(updated.status).toBe(200);
    expect(updated.body.label).toBe('Etiqueta renombrada');
    expect(updated.body.key).toBe('editable_e2e');
  });

  it('archiving and restoring a variable toggles its status', async () => {
    const created = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, key: 'archivable_e2e' });

    const archived = await request(app.getHttpServer())
      .post(`/variables/${created.body.id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(archived.body.status).toBe('ARCHIVED');

    const restored = await request(app.getHttpServer())
      .post(`/variables/${created.body.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(restored.body.status).toBe('ACTIVE');
  });

  it('deletes a variable that was never used', async () => {
    const created = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, key: 'eliminable_e2e' });

    const deleted = await request(app.getHttpServer())
      .delete(`/variables/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await request(app.getHttpServer())
      .get(`/variables/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterDelete.status).toBe(404);
  });

  it('an executive (no variables.delete permission) cannot delete a variable', async () => {
    const created = await request(app.getHttpServer())
      .post('/variables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, key: 'protegida_e2e' });

    const response = await request(app.getHttpServer())
      .delete(`/variables/${created.body.id}`)
      .set('Authorization', `Bearer ${executiveToken}`);

    expect(response.status).toBe(403);
  });

  it('returns 404 (not 403) for a variable id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/variables/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
