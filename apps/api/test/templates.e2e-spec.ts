import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Templates (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  const createPayload = {
    name: 'Seguimiento E2E',
    subject: 'Hola {nombre}, ¿seguimos en contacto?',
    body: 'Hola {nombre}, quería saber si {empresa} tuvo tiempo de revisar la propuesta.',
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

  it('an executive (templates.read only) can list but not create/update/duplicate/archive/delete', async () => {
    const list = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(list.status).toBe(200);

    const create = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send(createPayload);
    expect(create.status).toBe(403);
  });

  it('admin creates a template and the response includes the extracted variables', async () => {
    const response = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createPayload);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.variables).toEqual(['nombre', 'empresa']);
  });

  it('rejects a subject with malformed variable syntax', async () => {
    const response = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, subject: 'Hola {1nombre}' });

    expect(response.status).toBe(400);
  });

  it('rejects a body with unbalanced braces', async () => {
    const response = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, body: 'Hola {nombre, bienvenido' });

    expect(response.status).toBe(400);
  });

  it('admin lists templates and sees the created one', async () => {
    const response = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.map((t: { name: string }) => t.name)).toContain('Seguimiento E2E');
  });

  it('admin edits only the name, leaving subject/body untouched', async () => {
    const created = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, name: 'Editable E2E' });

    const updated = await request(app.getHttpServer())
      .patch(`/templates/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Editable Renombrada' });

    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Editable Renombrada');
    expect(updated.body.subject).toBe(createPayload.subject);
  });

  it('rejects an edit that introduces a malformed variable, leaving the template unchanged', async () => {
    const created = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, name: 'Protegida E2E' });

    const rejected = await request(app.getHttpServer())
      .patch(`/templates/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Hola {nombre incompleto}' });
    expect(rejected.status).toBe(400);

    const stillOriginal = await request(app.getHttpServer())
      .get(`/templates/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(stillOriginal.body.body).toBe(createPayload.body);
  });

  it('duplicating a template creates a second one with "(copia)" in the name and the same content', async () => {
    const created = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, name: 'Original E2E' });

    const duplicated = await request(app.getHttpServer())
      .post(`/templates/${created.body.id}/duplicate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(duplicated.status).toBe(201);
    expect(duplicated.body.id).not.toBe(created.body.id);
    expect(duplicated.body.name).toBe('Original E2E (copia)');
    expect(duplicated.body.subject).toBe(createPayload.subject);
    expect(duplicated.body.status).toBe('ACTIVE');
  });

  it('archiving and restoring a template toggles its status', async () => {
    const created = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, name: 'Archivable E2E' });

    const archived = await request(app.getHttpServer())
      .post(`/templates/${created.body.id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(archived.body.status).toBe('ARCHIVED');

    const restored = await request(app.getHttpServer())
      .post(`/templates/${created.body.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(restored.body.status).toBe('ACTIVE');
  });

  it('soft-deleting a template removes it from the list and from direct lookup', async () => {
    const created = await request(app.getHttpServer())
      .post('/templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...createPayload, name: 'Eliminable E2E' });

    const deleted = await request(app.getHttpServer())
      .delete(`/templates/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(204);

    const getAfterDelete = await request(app.getHttpServer())
      .get(`/templates/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getAfterDelete.status).toBe(404);

    const list = await request(app.getHttpServer())
      .get('/templates')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.map((t: { id: string }) => t.id)).not.toContain(created.body.id);
  });

  it('returns 404 (not 403) for a template id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/templates/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
