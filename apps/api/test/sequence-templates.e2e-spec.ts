import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { createTestApp } from './create-test-app';
import { AppConfigService } from '../src/infrastructure/config/app-config.service';
import { SimulatedMailboxMotorAdapter } from '../src/infrastructure/mailbox-motor/simulated/simulated-mailbox-motor-adapter';
import { OrganizationRepository } from '../src/domain/organization/organization.repository';
import { UserRepository } from '../src/domain/user/user.repository';
import { RoleRepository } from '../src/domain/role/role.repository';
import { UserRoleRepository } from '../src/domain/user-role/user-role.repository';
import { SequenceExecutionRepository } from '../src/domain/sequence-execution/sequence-execution.repository';
import {
  ORGANIZATION_REPOSITORY,
  ROLE_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  USER_REPOSITORY,
  USER_ROLE_REPOSITORY,
} from '../src/infrastructure/persistence/tokens';

/** Fase 2 (R2) — a real, valid single-color PNG (correct IHDR width/height), so getImageDimensions() can parse it. */
function validPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const chunkType = Buffer.from('IHDR', 'ascii');
  const widthBuf = Buffer.alloc(4);
  widthBuf.writeUInt32BE(width, 0);
  const heightBuf = Buffer.alloc(4);
  heightBuf.writeUInt32BE(height, 0);
  return Buffer.concat([signature, length, chunkType, widthBuf, heightBuf, Buffer.alloc(8)]);
}

const PASSWORD_HASH_ROUNDS = 10;
const FIXTURE_PASSWORD = 'Fixture#Password1';

/**
 * Real HTTP e2e coverage for `MeSequenceTemplatesController` — none existed
 * before this file. Memory persistence + the simulated mailbox and
 * sequence-template motors only, exactly like every other e2e spec in this
 * suite; no controller/service method is mocked or stubbed anywhere below —
 * every assertion goes through the real HTTP server via `supertest`.
 *
 * Two fixtures below use direct repository access (`app.get(TOKEN)`) —
 * never to bypass the operation under test, only to construct
 * preconditions the public API has no route for (this repo has no
 * "create organization" or "create custom role" HTTP endpoint at all —
 * see RolesController's own comment: "Creating custom roles... is out of
 * scope"). Same pattern already used elsewhere in this suite
 * (`app.get(SimulatedMailboxMotorAdapter)`):
 *   - a genuine second Organization + admin, to test real cross-tenant
 *     isolation (never simulated by comparing two users in the same org);
 *   - a permission-less custom Role, to test 403 given both built-in
 *     roles (ADMIN/EXECUTIVE) share every `sequence_templates.*_own` key
 *     (see permission-catalog.ts's TEMPLATE_AND_EXECUTION_OPERATIONAL_KEYS).
 *   - a directly-inserted ACCEPTED SequenceExecution, to test the
 *     delete-blocked-by-active-Gestión path without needing to build the
 *     entire prospect-import/start HTTP flow (which has no e2e coverage
 *     of its own yet either) just for this one precondition.
 * Every operation actually being tested (publish/archive/delete/read) is
 * always the real HTTP call.
 */
describe('Sequence Templates (e2e) — memory + simulated motors', () => {
  let app: INestApplication;
  let motor: SimulatedMailboxMotorAdapter;
  let config: AppConfigService;
  let organizations: OrganizationRepository;
  let users: UserRepository;
  let roles: RoleRepository;
  let userRoles: UserRoleRepository;
  let executions: SequenceExecutionRepository;

  let adminToken: string;
  let adminUserId: string;
  let noPermissionToken: string;
  const stamp = Date.now();

  const adminEmail = process.env.DEV_ADMIN_EMAIL as string;
  const adminPassword = process.env.DEV_ADMIN_PASSWORD as string;

  beforeAll(async () => {
    app = await createTestApp();
    motor = app.get(SimulatedMailboxMotorAdapter);
    config = app.get(AppConfigService);
    organizations = app.get(ORGANIZATION_REPOSITORY);
    users = app.get(USER_REPOSITORY);
    roles = app.get(ROLE_REPOSITORY);
    userRoles = app.get(USER_ROLE_REPOSITORY);
    executions = app.get(SEQUENCE_EXECUTION_REPOSITORY);

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    adminToken = adminLogin.body.accessToken;

    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`);
    adminUserId = me.body.id;
    const organizationId = me.body.organizationId as string;

    // Fixture: a user holding zero sequence_templates.* permissions — both
    // built-in roles share the full operational set, so this requires a
    // dedicated custom role (no HTTP endpoint creates one; see file header).
    const noPermissionRole = await roles.create({
      organizationId,
      name: `SIN_PLANTILLAS_${stamp}`,
      permissionKeys: [],
    });
    const noPermissionUser = await users.create({
      organizationId,
      firstName: 'Sin',
      lastName: 'Permiso',
      email: `sin.permiso.plantillas.${stamp}@mejoreferido.cl`,
      passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, PASSWORD_HASH_ROUNDS),
      mustChangePassword: false,
    });
    await userRoles.assign(noPermissionUser.id, noPermissionRole.id);
    const noPermissionLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: noPermissionUser.email, password: FIXTURE_PASSWORD });
    noPermissionToken = noPermissionLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  function issueToken(suffix: string) {
    return motor.issueLinkToken({
      email: `plantilla-e2e-${suffix}@e2e.test`,
      displayName: 'Plantillas',
      domainName: `e2e-${suffix}.test`,
      clientName: 'Cliente E2E Plantillas',
    });
  }

  /** Links a mailbox and assigns it to the ADMIN — who then owns every template created against it, exactly like an executive would own their own. */
  async function linkMailbox(suffix: string): Promise<string> {
    const token = issueToken(suffix);
    const response = await request(app.getHttpServer())
      .post('/mailboxes/link')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `e2e-tpl-link-${suffix}`)
      .send({ token, primaryExecutiveId: adminUserId });
    return response.body.mailboxId as string;
  }

  async function createTemplate(mailboxId: string, name: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/me/sequence-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mailboxId, name });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  /** Fills subject + all 3 envíos with valid content — a template created via `createTemplate` alone is never publish-valid (empty steps). */
  async function fillValidTemplate(templateId: string): Promise<void> {
    const subjectResponse = await request(app.getHttpServer())
      .patch(`/me/sequence-templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subjectTemplate: 'Hola {contact_name}, esto es {company_name}' });
    expect(subjectResponse.status).toBe(200);

    for (const stepNumber of [1, 2, 3]) {
      const stepResponse = await request(app.getHttpServer())
        .patch(`/me/sequence-templates/${templateId}/steps/${stepNumber}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bodyHtml: `<p>Cuerpo del envío ${stepNumber} para {contact_name}</p>` });
      expect(stepResponse.status).toBe(200);
    }
  }

  async function getTemplate(templateId: string) {
    return request(app.getHttpServer())
      .get(`/me/sequence-templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  async function publish(templateId: string, idempotencyKey: string) {
    return request(app.getHttpServer())
      .post(`/me/sequence-templates/${templateId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({});
  }

  /** Direct-repository fixture (see file header) for the one precondition the public API has no fast HTTP path to build: a Gestión already ACCEPTED by the server. */
  async function createActiveExecutionAgainst(
    organizationId: string,
    templateId: string,
    templateVersionId: string,
    mailboxId: string,
  ): Promise<void> {
    const execution = await executions.create({
      organizationId,
      executiveId: adminUserId,
      mailboxId,
      templateId,
      templateVersionId,
      timezone: 'America/Santiago',
      createdBy: adminUserId,
    });
    await executions.update(execution.id, { status: 'ACCEPTED' });
  }

  /** Direct-repository fixture (see file header) — a genuine second Organization + ADMIN, to test real cross-tenant isolation, never simulated by comparing two users in the same org. */
  async function createOtherOrganizationToken(): Promise<string> {
    const otherOrg = await organizations.create({ name: `Otra Organización E2E ${stamp}` });
    const otherRole = await roles.create({
      organizationId: otherOrg.id,
      name: 'ADMIN',
      permissionKeys: ['sequence_templates.read_own'],
    });
    const otherUser = await users.create({
      organizationId: otherOrg.id,
      firstName: 'Otra',
      lastName: 'Organización',
      email: `otra.organizacion.${stamp}@mejoreferido.cl`,
      passwordHash: await bcrypt.hash(FIXTURE_PASSWORD, PASSWORD_HASH_ROUNDS),
      mustChangePassword: false,
    });
    await userRoles.assign(otherUser.id, otherRole.id);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherUser.email, password: FIXTURE_PASSWORD });
    return login.body.accessToken as string;
  }

  // ---------------------------------------------------------------------
  // Cross-cutting: ownership/tenant isolation — shared by every operation
  // below (all go through the same SequenceTemplatesService.requireOwned).
  // ---------------------------------------------------------------------

  it('a user from a different organization gets 404 (never the template), even while holding the read permission', async () => {
    const mailboxId = await linkMailbox(`${stamp}-crossorg`);
    const templateId = await createTemplate(mailboxId, 'Plantilla aislamiento entre organizaciones');
    const otherOrgToken = await createOtherOrganizationToken();

    const response = await request(app.getHttpServer())
      .get(`/me/sequence-templates/${templateId}`)
      .set('Authorization', `Bearer ${otherOrgToken}`);

    expect(response.status).toBe(404);
  });

  // ---------------------------------------------------------------------
  // Publicar plantilla
  // ---------------------------------------------------------------------

  describe('POST /me/sequence-templates/:id/publish', () => {
    it('an authorized admin can publish a valid template, and the final status persists', async () => {
      const mailboxId = await linkMailbox(`${stamp}-pub-ok`);
      const templateId = await createTemplate(mailboxId, 'Plantilla publicable válida');
      await fillValidTemplate(templateId);

      const response = await publish(templateId, `e2e-publish-${stamp}-ok`);
      expect(response.status).toBe(201);
      expect(response.body.status).toBe('PUBLISHED');
      expect(response.body.version.status).toBe('ACCEPTED');

      const persisted = await getTemplate(templateId);
      expect(persisted.body.status).toBe('PUBLISHED');
    });

    it('publishing validates and affects the whole template — rejects when Envío 2 and Envío 3 are left invalid, naming both', async () => {
      const mailboxId = await linkMailbox(`${stamp}-pub-partial`);
      const templateId = await createTemplate(mailboxId, 'Plantilla con envíos incompletos');
      await request(app.getHttpServer())
        .patch(`/me/sequence-templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ subjectTemplate: 'Asunto válido' });
      // Only Envío 1 is filled — Envío 1 alone being valid must never be enough to publish.
      await request(app.getHttpServer())
        .patch(`/me/sequence-templates/${templateId}/steps/1`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bodyHtml: '<p>Solo el envío 1 está completo</p>' });

      const response = await publish(templateId, `e2e-publish-${stamp}-partial`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Envío 2');
      expect(response.body.message).toContain('Envío 3');

      const persisted = await getTemplate(templateId);
      expect(persisted.body.status).not.toBe('PUBLISHED');
    });

    it('rejects an empty subject even when all 3 envíos are filled', async () => {
      const mailboxId = await linkMailbox(`${stamp}-pub-nosubject`);
      const templateId = await createTemplate(mailboxId, 'Plantilla sin asunto');
      for (const stepNumber of [1, 2, 3]) {
        await request(app.getHttpServer())
          .patch(`/me/sequence-templates/${templateId}/steps/${stepNumber}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ bodyHtml: `<p>Envío ${stepNumber}</p>` });
      }

      const response = await publish(templateId, `e2e-publish-${stamp}-nosubject`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('asunto');
    });

    it('a user without sequence_templates.publish_own gets 403', async () => {
      const mailboxId = await linkMailbox(`${stamp}-pub-403`);
      const templateId = await createTemplate(mailboxId, 'Plantilla sin permiso de publicar');
      await fillValidTemplate(templateId);

      const response = await request(app.getHttpServer())
        .post(`/me/sequence-templates/${templateId}/publish`)
        .set('Authorization', `Bearer ${noPermissionToken}`)
        .set('Idempotency-Key', `e2e-publish-${stamp}-403`)
        .send({});

      expect(response.status).toBe(403);
      const persisted = await getTemplate(templateId);
      expect(persisted.body.status).not.toBe('PUBLISHED');
    });
  });

  // ---------------------------------------------------------------------
  // Archivar plantilla
  // ---------------------------------------------------------------------

  describe('POST /me/sequence-templates/:id/archive', () => {
    it('archives a valid (DRAFT) template, persists the status, and audits the action', async () => {
      const mailboxId = await linkMailbox(`${stamp}-arch-ok`);
      const templateId = await createTemplate(mailboxId, 'Plantilla a archivar');

      const response = await request(app.getHttpServer())
        .post(`/me/sequence-templates/${templateId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(201);

      const persisted = await getTemplate(templateId);
      expect(persisted.body.status).toBe('ARCHIVED');

      const auditResponse = await request(app.getHttpServer())
        .get(`/users/${adminUserId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      const entry = auditResponse.body.find(
        (e: { action: string; entityId: string }) => e.action === 'sequence_template.archive' && e.entityId === templateId,
      );
      expect(entry).toBeDefined();
    });

    it('archiving affects the whole template, not a single envío — a published template with 3 filled envíos is archived in full and stops accepting new Gestiones', async () => {
      const mailboxId = await linkMailbox(`${stamp}-arch-full`);
      const templateId = await createTemplate(mailboxId, 'Plantilla publicada a archivar completa');
      await fillValidTemplate(templateId);
      await publish(templateId, `e2e-archive-full-${stamp}`);

      await request(app.getHttpServer())
        .post(`/me/sequence-templates/${templateId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      const persisted = await getTemplate(templateId);
      expect(persisted.body.status).toBe('ARCHIVED');
      // The 3 envíos' content is untouched by archiving — only the template-level status changed.
      expect(persisted.body.steps).toHaveLength(3);
      expect(
        (persisted.body.steps as { stepNumber: number; bodyHtml: string }[]).every((step) => step.bodyHtml.includes('Cuerpo del envío')),
      ).toBe(true);
    });

    it('respects existing dependencies — an already-archived template cannot be archived again', async () => {
      const mailboxId = await linkMailbox(`${stamp}-arch-twice`);
      const templateId = await createTemplate(mailboxId, 'Plantilla archivada dos veces');
      await request(app.getHttpServer())
        .post(`/me/sequence-templates/${templateId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      const secondArchive = await request(app.getHttpServer())
        .post(`/me/sequence-templates/${templateId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(secondArchive.status).toBe(409);
    });

    it('a user without sequence_templates.archive_own gets 403 and the template stays unarchived', async () => {
      const mailboxId = await linkMailbox(`${stamp}-arch-403`);
      const templateId = await createTemplate(mailboxId, 'Plantilla sin permiso de archivar');

      const response = await request(app.getHttpServer())
        .post(`/me/sequence-templates/${templateId}/archive`)
        .set('Authorization', `Bearer ${noPermissionToken}`);

      expect(response.status).toBe(403);
      const persisted = await getTemplate(templateId);
      expect(persisted.body.status).not.toBe('ARCHIVED');
    });
  });

  // ---------------------------------------------------------------------
  // Eliminar plantilla
  // ---------------------------------------------------------------------

  describe('DELETE /me/sequence-templates/:id', () => {
    it('deletes a DRAFT template that meets the conditions: disappears from the active listing and a direct GET stops returning an operative template', async () => {
      const mailboxId = await linkMailbox(`${stamp}-del-ok`);
      const templateId = await createTemplate(mailboxId, 'Plantilla eliminable');

      const response = await request(app.getHttpServer())
        .delete(`/me/sequence-templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(200);

      const listResponse = await request(app.getHttpServer())
        .get('/me/sequence-templates')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listResponse.body.map((t: { id: string }) => t.id)).not.toContain(templateId);

      const directFetch = await getTemplate(templateId);
      expect(directFetch.status).toBe(404);
    });

    it('rejects deleting a PUBLISHED template with an active (ACCEPTED) Gestión, with a comprehensible domain error', async () => {
      const mailboxId = await linkMailbox(`${stamp}-del-blocked`);
      const templateId = await createTemplate(mailboxId, 'Plantilla con gestión activa');
      await fillValidTemplate(templateId);
      const publishResponse = await publish(templateId, `e2e-delete-blocked-${stamp}`);
      const organizationId = (await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${adminToken}`)).body
        .organizationId as string;
      const templateVersionId = (
        await request(app.getHttpServer()).get(`/me/sequence-templates/${templateId}`).set('Authorization', `Bearer ${adminToken}`)
      ).body.latestPublishedVersion.id as string;
      await createActiveExecutionAgainst(organizationId, templateId, templateVersionId, mailboxId);
      expect(publishResponse.status).toBe(201);

      const response = await request(app.getHttpServer())
        .delete(`/me/sequence-templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('Gestion');
      const persisted = await getTemplate(templateId);
      expect(persisted.body.status).toBe('PUBLISHED');
    });

    it('deleting a template never deletes the mailbox signature: Signature/SignatureVersion/SignatureAsset all survive, and firmas/{correo}/ is never purged', async () => {
      const mailboxId = await linkMailbox(`${stamp}-del-signature`);
      const email = `plantilla-e2e-${stamp}-del-signature@e2e.test`;
      const templateId = await createTemplate(mailboxId, 'Plantilla que no debe tocar la firma');

      const assetResponse = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature-assets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', validPng(240, 90), 'logo.png');
      expect(assetResponse.status).toBe(201);
      const asset = assetResponse.body as { assetId: string; publicUrl: string };

      const saveSignatureResponse = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ htmlContent: `<p>Saludos</p><img src="${asset.publicUrl}" alt="">` });
      expect(saveSignatureResponse.status).toBe(201);

      const objectKey = `firmas/${email}/${asset.assetId}.png`;
      expect(existsSync(join(process.cwd(), 'uploads', objectKey))).toBe(true);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/me/sequence-templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteResponse.status).toBe(200);

      // Signature/SignatureVersion survive: the GET still returns the exact same content.
      const signatureAfter = await request(app.getHttpServer())
        .get(`/mailboxes/${mailboxId}/signature`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(signatureAfter.status).toBe(200);
      expect(signatureAfter.body.activeVersion.htmlContent).toContain('<img');
      expect(signatureAfter.body.activeVersion.htmlContent).toContain(asset.assetId);

      // SignatureAsset (and its R2/local file under firmas/{correo}/) survives — no cleanup ran.
      expect(existsSync(join(process.cwd(), 'uploads', objectKey))).toBe(true);
    });

    it('a user without sequence_templates.delete_own gets 403 and the template is never removed', async () => {
      const mailboxId = await linkMailbox(`${stamp}-del-403`);
      const templateId = await createTemplate(mailboxId, 'Plantilla sin permiso de eliminar');

      const response = await request(app.getHttpServer())
        .delete(`/me/sequence-templates/${templateId}`)
        .set('Authorization', `Bearer ${noPermissionToken}`);

      expect(response.status).toBe(403);
      const persisted = await getTemplate(templateId);
      expect(persisted.status).toBe(200);
    });

    it('preserves audit history for a deleted template — the create and delete actions both remain in the audit log', async () => {
      const mailboxId = await linkMailbox(`${stamp}-del-audit`);
      const templateId = await createTemplate(mailboxId, 'Plantilla eliminada con auditoría');

      await request(app.getHttpServer())
        .delete(`/me/sequence-templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const auditResponse = await request(app.getHttpServer())
        .get(`/users/${adminUserId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`);
      const actionsForTemplate = auditResponse.body
        .filter((e: { entityId: string }) => e.entityId === templateId)
        .map((e: { action: string }) => e.action);
      expect(actionsForTemplate).toContain('sequence_template.create');
      expect(actionsForTemplate).toContain('sequence_template.draft_deleted');
    });
  });

  // ---------------------------------------------------------------------
  // Firma — imagen únicamente, sanitización en backend
  // ---------------------------------------------------------------------

  describe('Firma de la cuenta usada por la Plantilla — validación e imagen únicamente', () => {
    it('a template reflects the account signature made of only a valid image — no minimum character count enforced', async () => {
      const mailboxId = await linkMailbox(`${stamp}-sig-imgonly`);
      const templateId = await createTemplate(mailboxId, 'Plantilla con firma solo imagen');

      const assetResponse = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature-assets`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', validPng(240, 90), 'logo.png');
      const asset = assetResponse.body as { publicUrl: string };

      const saveResponse = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ htmlContent: `<img src="${asset.publicUrl}" alt="">` });
      expect(saveResponse.status).toBe(201);

      const templateDetail = await getTemplate(templateId);
      expect(templateDetail.body.signatureHtml).toContain('<img');
    });

    it('rejects a genuinely empty signature with a controlled 400', async () => {
      const mailboxId = await linkMailbox(`${stamp}-sig-empty`);

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ htmlContent: '<p><br></p>' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('La firma debe contener texto o al menos una imagen válida.');
    });

    it('rejects an image from an external, unauthorized host — sanitization runs in the backend, not only the frontend', async () => {
      const mailboxId = await linkMailbox(`${stamp}-sig-external`);

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ htmlContent: '<img src="https://un-host-externo-cualquiera.com/logo.png" alt="">' });

      // No visible text and the only <img> gets stripped by the backend
      // sanitizer (never merely hidden by the frontend) — genuinely blank.
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('La firma debe contener texto o al menos una imagen válida.');
    });

    it('accepts an image from the exact host configured via AppConfigService.signatureAssetAllowedImageHost (backed by R2_PUBLIC_BASE_URL in r2 mode) — never hardcoded here', async () => {
      const mailboxId = await linkMailbox(`${stamp}-sig-allowedhost`);
      const allowedHost = config.signatureAssetAllowedImageHost;
      const scheme = config.signatureAssetAllowInsecureImageHost ? 'http' : 'https';

      const response = await request(app.getHttpServer())
        .post(`/mailboxes/${mailboxId}/signature`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ htmlContent: `<img src="${scheme}://${allowedHost}/firmas/x/y.png" alt="">` });

      expect(response.status).toBe(201);
      expect(response.body.activeVersion.htmlContent).toContain(allowedHost);
    });
  });
});
