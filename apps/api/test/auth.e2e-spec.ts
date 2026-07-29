import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

/**
 * Exercises the whole first functional milestone's auth slice against the
 * real memory + mock stack (the actual DevSeedService runs, seeding a
 * fresh in-memory organization/admin/executive for this test process) —
 * no PostgreSQL, no Hetzner, no real engine involved.
 */
describe('Auth (e2e) — memory + mock', () => {
  let app: INestApplication;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in as the seeded admin and returns the full permission catalog', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });

    expect(response.status).toBe(200);
    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.user.email).toBe(adminEmail);
    expect(response.body.user.permissions).toEqual(
      expect.arrayContaining(['users.read', 'roles.manage', 'audit.read']),
    );
  });

  it('logs in as the seeded executive with only the scoped permission set', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: executiveEmail, password: executivePassword });

    expect(response.status).toBe(200);
    expect(response.body.user.permissions.sort()).toEqual(
      [
        'mailboxes.read.assigned',
        'sequence_steps.manage.own',
        'sequences.manage.own',
        'signatures.preview',
        'signatures.read',
        'signatures.test',
        'signatures.update',
        'templates.read',
        'clients.read.assigned',
        'domains.read',
        'conversations.read.assigned',
        'conversations.update',
        'conversations.assign',
        'conversations.resolve',
        'conversations.archive',
        'conversation_tags.read',
        'conversation_tags.create',
        'conversation_notes.create',
        'conversation_notes.read',
        'conversation_notes.update',
        'conversation_notes.delete',
        'unmatched_messages.read',
        'unmatched_messages.associate',
        'sequences.publish',
        'sequence_imports.create',
        'sequence_imports.read',
        'sequence_imports.cancel',
        'sequence_contacts.read',
        'sequence_contacts.remove',
        'sequence_contacts.suppress',
        'sequence_templates.create_own',
        'sequence_templates.read_own',
        'sequence_templates.update_own',
        'sequence_templates.publish_own',
        'sequence_templates.archive_own',
        'sequence_executions.create_own',
        'sequence_executions.read_own',
        'sequence_executions.import_own',
        'sequence_executions.start_own',
        'sequence_executions.refresh_status_own',
      ].sort(),
    );
  });

  it('rejects a wrong password with a generic 401, never revealing whether the email exists', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'not-the-real-password' });
    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@local.test', password: 'whatever' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('GET /auth/me requires a valid bearer token', async () => {
    const withoutToken = await request(app.getHttpServer()).get('/auth/me');
    expect(withoutToken.status).toBe(401);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });

    const withToken = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(withToken.status).toBe(200);
    expect(withToken.body.email).toBe(adminEmail);
  });

  it('rejects requests carrying a malformed or tampered token', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-real-jwt');

    expect(response.status).toBe(401);
  });

  it('POST /auth/logout always succeeds (stateless JWT, no server-side session to fail on)', async () => {
    const response = await request(app.getHttpServer()).post('/auth/logout');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
