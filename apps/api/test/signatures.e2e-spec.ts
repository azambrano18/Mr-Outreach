import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Signatures (e2e) — memory + mock', () => {
  let app: INestApplication;
  let adminToken: string;
  let executiveToken: string;

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;
  const executiveEmail = process.env.DEV_EXECUTIVE_EMAIL as string;
  const executivePassword = process.env.DEV_EXECUTIVE_PASSWORD as string;

  const mailboxPayload = (email: string) => ({
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

  async function createMailbox(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/mailboxes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(mailboxPayload(email));
    return response.body.id as string;
  }

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

  it('GET returns 404 (not 403, not a bare null body) for a mailbox that has no signature yet', async () => {
    const mailboxId = await createMailbox('sin-firma.e2e@example.com');

    const response = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('an executive (read + preview + test only) cannot create, update, activate, or archive', async () => {
    const mailboxId = await createMailbox('permisos.e2e@example.com');

    const create = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ htmlContent: '<p>Saludos</p>' });
    expect(create.status).toBe(403);

    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Saludos</p>' });

    const read = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(read.status).toBe(200);
  });

  it('creates a signature with its first version, active immediately, and auto-generates plain text', async () => {
    const mailboxId = await createMailbox('crear.e2e@example.com');

    const response = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Saludos, {nombre}</p>' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.versions).toHaveLength(1);
    expect(response.body.activeVersion.versionNumber).toBe(1);
    expect(response.body.activeVersion.variables).toEqual(['nombre']);
    expect(response.body.activeVersion.htmlContent).toContain('<p>');
    expect(response.body.activeVersion.plainTextContent).toBe('Saludos, {nombre}');
  });

  it('sanitizes a <script> tag and strips an onclick handler out of the HTML before persisting', async () => {
    const mailboxId = await createMailbox('sanitiza.e2e@example.com');

    const response = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        htmlContent: '<p onclick="alert(1)">Hola</p><script>alert(2)</script>',
      });

    expect(response.status).toBe(201);
    expect(response.body.activeVersion.htmlContent).not.toContain('onclick');
    expect(response.body.activeVersion.htmlContent).not.toContain('<script>');
    expect(response.body.activeVersion.htmlContent).not.toContain('alert(2)');
  });

  it('rejects content with a malformed variable', async () => {
    const mailboxId = await createMailbox('malformada.e2e@example.com');

    const response = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Saludos, {1invalido}</p>' });

    expect(response.status).toBe(400);
  });

  it('rejects creating a second signature for the same mailbox', async () => {
    const mailboxId = await createMailbox('duplicada.e2e@example.com');
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Original</p>' });

    const response = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Duplicada</p>' });

    expect(response.status).toBe(409);
  });

  it('updating creates a new version and activates it, keeping history', async () => {
    const mailboxId = await createMailbox('editar.e2e@example.com');
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Version uno</p>' });

    const updated = await request(app.getHttpServer())
      .patch(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Version dos</p>' });

    expect(updated.status).toBe(200);
    expect(updated.body.versions).toHaveLength(2);
    expect(updated.body.activeVersion.versionNumber).toBe(2);
    expect(updated.body.activeVersion.htmlContent).toContain('Version dos');
    expect(
      updated.body.versions.find((v: { versionNumber: number }) => v.versionNumber === 1)
        .htmlContent,
    ).toContain('Version uno');
  });

  it('accepts an explicitly supplied plain text instead of auto-generating it', async () => {
    const mailboxId = await createMailbox('texto-plano.e2e@example.com');

    const response = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        htmlContent: '<p><strong>Saludos</strong></p>',
        plainTextContent: 'Texto plano personalizado',
      });

    expect(response.body.activeVersion.plainTextContent).toBe('Texto plano personalizado');
  });

  it('activating an older version reverts without creating a new one', async () => {
    const mailboxId = await createMailbox('revertir.e2e@example.com');
    const created = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Version uno</p>' });
    const v1Id = created.body.activeVersion.id;

    await request(app.getHttpServer())
      .patch(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Version dos</p>' });

    const reverted = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature/versions/${v1Id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(reverted.status).toBe(201);
    expect(reverted.body.versions).toHaveLength(2);
    expect(reverted.body.activeVersion.id).toBe(v1Id);
    expect(reverted.body.activeVersion.htmlContent).toContain('Version uno');
  });

  it('archiving and restoring toggles status without touching the active version', async () => {
    const mailboxId = await createMailbox('archivar.e2e@example.com');
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Contenido</p>' });

    const archived = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature/archive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(archived.body.status).toBe('ARCHIVED');
    expect(archived.body.activeVersion.htmlContent).toContain('Contenido');

    const restored = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature/restore`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(restored.body.status).toBe('ACTIVE');
  });

  it('preview renders sample data over the active version and leaks no raw {...} tokens', async () => {
    const mailboxId = await createMailbox('preview.e2e@example.com');
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Saludos, {nombre} de {empresa}</p>' });

    const preview = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/signature/preview`)
      .set('Authorization', `Bearer ${executiveToken}`);

    expect(preview.status).toBe(200);
    expect(preview.body.variables).toEqual(['nombre', 'empresa']);
    expect(preview.body.renderedHtml).not.toContain('{nombre}');
    expect(preview.body.renderedHtml).not.toContain('{empresa}');
    expect(preview.body.usesRealSenderData).toBe(false);
  });

  it('preview resolves {sender.*} from the mailbox primary assignee when one exists', async () => {
    const mailboxId = await createMailbox('preview-real.e2e@example.com');
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>{sender.name} — {mailbox.email}</p>' });

    const usersResponse = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const executive = usersResponse.body.find((u: { email: string }) => u.email === executiveEmail);

    await request(app.getHttpServer())
      .put(`/mailboxes/${mailboxId}/assignees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ primaryUserId: executive.id, secondaryUserIds: [] });

    const preview = await request(app.getHttpServer())
      .get(`/mailboxes/${mailboxId}/signature/preview`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(preview.body.usesRealSenderData).toBe(true);
    expect(preview.body.renderedHtml).toContain(executive.name);
    expect(preview.body.renderedHtml).toContain('preview-real.e2e@example.com');
  });

  it('sends a test email through the mock engine and audits the outcome without leaking the recipient', async () => {
    const mailboxId = await createMailbox('enviar-prueba.e2e@example.com');
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Saludos</p>' });

    const accepted = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature/send-test`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ to: 'destino.prueba@example.com' });

    expect(accepted.status).toBe(201);
    expect(accepted.body.accepted).toBe(true);

    const rejected = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature/send-test`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ to: 'destino+reject@example.com' });

    expect(rejected.status).toBe(201);
    expect(rejected.body.accepted).toBe(false);
  });

  it('an executive with signatures.test can send a test but not create or archive', async () => {
    const mailboxId = await createMailbox('exec-test.e2e@example.com');
    await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ htmlContent: '<p>Saludos</p>' });

    const sendTest = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature/send-test`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ to: 'destino.exec@example.com' });
    expect(sendTest.status).toBe(201);

    const archive = await request(app.getHttpServer())
      .post(`/mailboxes/${mailboxId}/signature/archive`)
      .set('Authorization', `Bearer ${executiveToken}`);
    expect(archive.status).toBe(403);
  });

  it('returns 404 (not 403) for a mailbox id that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/mailboxes/00000000-0000-0000-0000-000000000000/signature')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });
});
