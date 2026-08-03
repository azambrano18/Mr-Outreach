import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { EngineClient } from '../../domain/engine/engine-client';
import { MailboxAssignment } from '../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { Organization } from '../../domain/organization/organization.entity';
import { OrganizationRepository } from '../../domain/organization/organization.repository';
import { SignatureVersion } from '../../domain/signature/signature-version.entity';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { Signature } from '../../domain/signature/signature.entity';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { User } from '../../domain/user/user.entity';
import { UserRepository } from '../../domain/user/user.repository';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { HtmlSanitizerService } from '../../infrastructure/security/html-sanitizer.service';
import { SecretEncryptionService } from '../../infrastructure/security/secret-encryption.service';
import { SignaturesService } from './signatures.service';

const ALLOWED_IMAGE_HOST = 'assets.mejoreferido.cl';

describe('SignaturesService', () => {
  let signatures: jest.Mocked<SignatureRepository>;
  let versions: jest.Mocked<SignatureVersionRepository>;
  let mailboxes: jest.Mocked<MailboxRepository>;
  let assignments: jest.Mocked<MailboxAssignmentRepository>;
  let users: jest.Mocked<UserRepository>;
  let organizations: jest.Mocked<OrganizationRepository>;
  let auditLogs: jest.Mocked<AuditLogRepository>;
  let engineClient: jest.Mocked<EngineClient>;
  let sanitizer: jest.Mocked<HtmlSanitizerService>;
  let secrets: jest.Mocked<SecretEncryptionService>;
  let config: jest.Mocked<AppConfigService>;
  let service: SignaturesService;

  const orgId = 'org_1';
  const otherOrgId = 'org_2';

  const buildMailbox = (overrides: Partial<Mailbox> = {}): Mailbox =>
    ({
      id: 'mailbox_1',
      organizationId: orgId,
      name: 'Ventas',
      email: 'ventas@example.com',
      fromName: 'Equipo de Ventas',
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        encryption: 'STARTTLS',
        username: 'ventas@example.com',
        verifyCertificate: true,
        secretCiphertext: 'iv.tag.cipher',
      },
      ...overrides,
    }) as Mailbox;

  const buildOrganization = (overrides: Partial<Organization> = {}): Organization => ({
    id: orgId,
    name: 'MejoReferido',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

  const buildSignature = (overrides: Partial<Signature> = {}): Signature => ({
    id: 'signature_1',
    organizationId: orgId,
    mailboxId: 'mailbox_1',
    status: 'ACTIVE',
    activeVersionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const buildVersion = (overrides: Partial<SignatureVersion> = {}): SignatureVersion => ({
    id: 'version_1',
    signatureId: 'signature_1',
    versionNumber: 1,
    htmlContent: '<p>Saludos, {nombre}</p>',
    plainTextContent: 'Saludos, {nombre}',
    createdAt: new Date(),
    createdBy: 'actor_1',
    ...overrides,
  });

  const buildAssignment = (overrides: Partial<MailboxAssignment> = {}): MailboxAssignment => ({
    id: 'assignment_1',
    organizationId: orgId,
    mailboxId: 'mailbox_1',
    userId: 'user_1',
    role: 'PRIMARY',
    assignedBy: 'admin_1',
    assignedAt: new Date(),
    ...overrides,
  });

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user_1',
      organizationId: orgId,
      firstName: 'María',
      lastName: 'Pérez',
      email: 'maria@example.com',
      ...overrides,
    }) as User;

  beforeEach(() => {
    signatures = {
      findById: jest.fn(),
      findByMailbox: jest.fn(),
      findAllByOrganization: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    versions = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySignature: jest.fn(),
    };
    mailboxes = {
      findById: jest.fn(),
      findByIdIncludingDeleted: jest.fn(),
      findByEmail: jest.fn(),
      findByServerMailboxId: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      createLinked: jest.fn(),
      update: jest.fn(),
    };
    assignments = {
      upsert: jest.fn(),
      remove: jest.fn(),
      findByMailbox: jest.fn().mockResolvedValue([]),
      findByUser: jest.fn(),
      findAllByOrganization: jest.fn().mockResolvedValue([]),
    };
    users = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByEmailAnyOrganization: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    organizations = {
      findById: jest.fn().mockResolvedValue(buildOrganization()),
      create: jest.fn(),
    };
    auditLogs = { record: jest.fn(), findAll: jest.fn() };
    engineClient = {
      testMailbox: jest.fn(),
      sendMail: jest.fn(),
      checkHealth: jest.fn(),
      fetchInbox: jest.fn(),
      fetchThread: jest.fn(),
      setThreadReadState: jest.fn(),
    };
    sanitizer = {
      sanitize: jest.fn((html: string) => html),
      sanitizeSignatureHtml: jest.fn((html: string) => html),
    } as unknown as jest.Mocked<HtmlSanitizerService>;
    secrets = {
      encrypt: jest.fn(),
      decrypt: jest.fn(() => 'decrypted-password'),
    } as unknown as jest.Mocked<SecretEncryptionService>;
    config = {
      signatureAssetAllowedImageHost: ALLOWED_IMAGE_HOST,
      signatureAssetAllowInsecureImageHost: false,
    } as unknown as jest.Mocked<AppConfigService>;

    service = new SignaturesService(
      signatures,
      versions,
      mailboxes,
      assignments,
      users,
      organizations,
      auditLogs,
      engineClient,
      sanitizer,
      secrets,
      config,
    );
  });

  describe('getByMailbox', () => {
    it('throws NotFoundException when the mailbox has no signature yet', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(null);

      await expect(service.getByMailbox(orgId, 'mailbox_1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a mailbox in a different organization (never 403)', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox({ organizationId: otherOrgId }));

      await expect(service.getByMailbox(orgId, 'mailbox_1')).rejects.toThrow(NotFoundException);
    });

    it('marks the active version and sorts history most-recent-first', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: 'version_2' }));
      versions.findBySignature.mockResolvedValue([
        buildVersion({ id: 'version_1', versionNumber: 1 }),
        buildVersion({ id: 'version_2', versionNumber: 2, htmlContent: '<p>Atentamente</p>' }),
      ]);

      const result = await service.getByMailbox(orgId, 'mailbox_1');

      expect(result.versions.map((v) => v.id)).toEqual(['version_2', 'version_1']);
      expect(result.activeVersion?.id).toBe('version_2');
      expect(result.versions.find((v) => v.id === 'version_1')?.isActive).toBe(false);
    });
  });

  describe('create', () => {
    it('sanitizes the HTML, auto-generates plain text, and activates the first version', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.create.mockResolvedValue(buildSignature());
      versions.create.mockResolvedValue(buildVersion());
      signatures.update.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));

      const result = await service.create(
        orgId,
        'mailbox_1',
        '<p>Saludos, {nombre}</p>',
        undefined,
        'actor_1',
      );

      expect(sanitizer.sanitizeSignatureHtml).toHaveBeenCalledWith(
        '<p>Saludos, {nombre}</p>',
        ALLOWED_IMAGE_HOST,
        false,
      );
      expect(versions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          signatureId: 'signature_1',
          plainTextContent: 'Saludos, {nombre}',
        }),
      );
      expect(signatures.update).toHaveBeenCalledWith('signature_1', {
        activeVersionId: 'version_1',
      });
      expect(result.activeVersion?.id).toBe('version_1');
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'signature.create' }),
      );
    });

    it('keeps an explicitly supplied plain text instead of auto-generating it', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.create.mockResolvedValue(buildSignature());
      versions.create.mockResolvedValue(buildVersion());
      signatures.update.mockResolvedValue(buildSignature());

      await service.create(orgId, 'mailbox_1', '<p>Saludos</p>', 'Custom plain text', 'actor_1');

      expect(versions.create).toHaveBeenCalledWith(
        expect.objectContaining({ plainTextContent: 'Custom plain text' }),
      );
    });
  });

  /**
   * A signature is valid with text alone, an image alone, or both — only
   * genuinely empty content is rejected. Exercised through the public
   * `create()` method since `buildContent`/`hasVisibleSignatureContent` are
   * private; `sanitizeSignatureHtml` is mocked per-test to stand in for
   * whatever sanitization would actually produce, so these tests describe
   * the blankness rule itself, independent of sanitize-html's own behavior.
   */
  describe('buildContent — image-only / text-only / blank signature validation', () => {
    it('accepts text-only content', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.create.mockResolvedValue(buildSignature());
      versions.create.mockResolvedValue(buildVersion());
      signatures.update.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      sanitizer.sanitizeSignatureHtml.mockReturnValue('<p>Saludos</p>');

      await expect(
        service.create(orgId, 'mailbox_1', '<p>Saludos</p>', undefined, 'actor_1'),
      ).resolves.toBeDefined();
    });

    it('accepts image-only content — no minimum character count is enforced when a valid image is present', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.create.mockResolvedValue(buildSignature());
      versions.create.mockResolvedValue(buildVersion());
      signatures.update.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      const imageOnlyHtml = `<img src="https://${ALLOWED_IMAGE_HOST}/firmas/ventas@example.com/asset.png" alt="">`;
      sanitizer.sanitizeSignatureHtml.mockReturnValue(imageOnlyHtml);

      await service.create(orgId, 'mailbox_1', imageOnlyHtml, undefined, 'actor_1');

      expect(versions.create).toHaveBeenCalledWith(
        expect.objectContaining({ htmlContent: imageOnlyHtml }),
      );
    });

    it('accepts text and image together', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.create.mockResolvedValue(buildSignature());
      versions.create.mockResolvedValue(buildVersion());
      signatures.update.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      const html = `<p>Saludos</p><img src="https://${ALLOWED_IMAGE_HOST}/firmas/ventas@example.com/asset.png" alt="">`;
      sanitizer.sanitizeSignatureHtml.mockReturnValue(html);

      await expect(service.create(orgId, 'mailbox_1', html, undefined, 'actor_1')).resolves.toBeDefined();
    });

    it.each([
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['an empty paragraph', '<p></p>'],
      ['a paragraph with only a line break', '<p><br></p>'],
      ['an empty container', '<div></div>'],
    ])('rejects %s as blank, with a message that never mentions requiring text', async (_label, sanitizedOutput) => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.create.mockResolvedValue(buildSignature());
      sanitizer.sanitizeSignatureHtml.mockReturnValue(sanitizedOutput);

      await expect(service.create(orgId, 'mailbox_1', '<p>algo</p>', undefined, 'actor_1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(orgId, 'mailbox_1', '<p>algo</p>', undefined, 'actor_1')).rejects.toThrow(
        'La firma debe contener texto o al menos una imagen válida.',
      );
      expect(versions.create).not.toHaveBeenCalled();
    });

    it('rejects content whose only image was stripped by sanitization (e.g. an unauthorized host or data:) — never treats the raw, pre-sanitization HTML as evidence of a valid image', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.create.mockResolvedValue(buildSignature());
      // Simulates sanitizeSignatureHtml actually stripping a disallowed <img>, leaving nothing.
      sanitizer.sanitizeSignatureHtml.mockReturnValue('');

      await expect(
        service.create(orgId, 'mailbox_1', '<img src="javascript:alert(1)">', undefined, 'actor_1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('creates a new version and activates it, keeping the old one in history', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      versions.create.mockResolvedValue(buildVersion({ id: 'version_2', versionNumber: 2 }));
      signatures.update.mockResolvedValue(buildSignature({ activeVersionId: 'version_2' }));
      versions.findBySignature.mockResolvedValue([
        buildVersion({ id: 'version_1', versionNumber: 1 }),
        buildVersion({ id: 'version_2', versionNumber: 2 }),
      ]);

      const result = await service.update(
        orgId,
        'mailbox_1',
        '<p>Nuevo saludo</p>',
        undefined,
        'actor_1',
      );

      expect(versions.create).toHaveBeenCalledWith(
        expect.objectContaining({ signatureId: 'signature_1' }),
      );
      expect(result.versions).toHaveLength(2);
      expect(result.activeVersion?.id).toBe('version_2');
    });

    it('throws NotFoundException when the mailbox has no signature yet', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(null);

      await expect(
        service.update(orgId, 'mailbox_1', '<p>X</p>', undefined, 'actor_1'),
      ).rejects.toThrow(NotFoundException);
      expect(versions.create).not.toHaveBeenCalled();
    });
  });

  describe('activateVersion', () => {
    it('reverts to an older version without creating a new one', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: 'version_2' }));
      versions.findById.mockResolvedValue(buildVersion({ id: 'version_1', versionNumber: 1 }));
      signatures.update.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      versions.findBySignature.mockResolvedValue([buildVersion({ id: 'version_1' })]);

      await service.activateVersion(orgId, 'mailbox_1', 'version_1', 'actor_1');

      expect(versions.create).not.toHaveBeenCalled();
      expect(signatures.update).toHaveBeenCalledWith('signature_1', {
        activeVersionId: 'version_1',
      });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'signature.activate' }),
      );
    });

    it('rejects a versionId that belongs to a different signature', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature());
      versions.findById.mockResolvedValue(
        buildVersion({ id: 'foreign_version', signatureId: 'signature_other' }),
      );

      await expect(
        service.activateVersion(orgId, 'mailbox_1', 'foreign_version', 'actor_1'),
      ).rejects.toThrow(NotFoundException);
      expect(signatures.update).not.toHaveBeenCalled();
    });
  });

  describe('setStatus', () => {
    it('archives and audits the action', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature());
      signatures.update.mockResolvedValue(buildSignature({ status: 'ARCHIVED' }));
      versions.findBySignature.mockResolvedValue([]);

      const result = await service.setStatus(orgId, 'mailbox_1', 'ARCHIVED', 'actor_1');

      expect(result.status).toBe('ARCHIVED');
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'signature.archive' }),
      );
    });

    it('restores and audits the action', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ status: 'ARCHIVED' }));
      signatures.update.mockResolvedValue(buildSignature({ status: 'ACTIVE' }));
      versions.findBySignature.mockResolvedValue([]);

      await service.setStatus(orgId, 'mailbox_1', 'ACTIVE', 'actor_1');

      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'signature.restore' }),
      );
    });
  });

  describe('self-service (getByMailboxForExecutive / saveForExecutive / previewForExecutive / sendTestForExecutive)', () => {
    it('getByMailboxForExecutive returns the signature when the mailbox is assigned to the user', async () => {
      assignments.findByUser.mockResolvedValue([buildAssignment({ userId: 'user_1' })]);
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature());
      versions.findBySignature.mockResolvedValue([]);

      const result = await service.getByMailboxForExecutive(orgId, 'user_1', 'mailbox_1');

      expect(result.id).toBe('signature_1');
    });

    it('getByMailboxForExecutive throws NotFoundException (not ForbiddenException) when the mailbox is not assigned to the user', async () => {
      assignments.findByUser.mockResolvedValue([]);

      await expect(service.getByMailboxForExecutive(orgId, 'user_1', 'mailbox_1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mailboxes.findById).not.toHaveBeenCalled();
    });

    it('saveForExecutive creates a signature when none exists yet, only for an assigned mailbox', async () => {
      assignments.findByUser.mockResolvedValue([buildAssignment({ userId: 'user_1' })]);
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValueOnce(null);
      signatures.create.mockResolvedValue(buildSignature());
      versions.create.mockResolvedValue(buildVersion());
      signatures.update.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));

      await service.saveForExecutive(
        orgId,
        'user_1',
        'mailbox_1',
        '<p>Firma nueva</p>',
        undefined,
        'user_1',
      );

      expect(signatures.create).toHaveBeenCalledWith({
        organizationId: orgId,
        mailboxId: 'mailbox_1',
      });
    });

    it('saveForExecutive updates (new version) when a signature already exists', async () => {
      assignments.findByUser.mockResolvedValue([buildAssignment({ userId: 'user_1' })]);
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      versions.create.mockResolvedValue(buildVersion({ id: 'version_2', versionNumber: 2 }));
      versions.findBySignature.mockResolvedValue([
        buildVersion(),
        buildVersion({ id: 'version_2' }),
      ]);
      signatures.update.mockResolvedValue(buildSignature({ activeVersionId: 'version_2' }));

      await service.saveForExecutive(
        orgId,
        'user_1',
        'mailbox_1',
        '<p>Firma editada</p>',
        undefined,
        'user_1',
      );

      expect(signatures.create).not.toHaveBeenCalled();
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'signature.update' }),
      );
    });

    it('saveForExecutive throws NotFoundException for a mailbox not assigned to the user, before touching the signature', async () => {
      assignments.findByUser.mockResolvedValue([]);

      await expect(
        service.saveForExecutive(orgId, 'user_1', 'mailbox_1', '<p>x</p>', undefined, 'user_1'),
      ).rejects.toThrow(NotFoundException);
      expect(signatures.findByMailbox).not.toHaveBeenCalled();
      expect(signatures.create).not.toHaveBeenCalled();
    });

    it('previewForExecutive and sendTestForExecutive both 404 for an unassigned mailbox', async () => {
      assignments.findByUser.mockResolvedValue([]);

      await expect(service.previewForExecutive(orgId, 'user_1', 'mailbox_1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.sendTestForExecutive(orgId, 'user_1', 'mailbox_1', 'to@example.com', 'user_1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('preview', () => {
    it('substitutes known sample values and flags unknown ones with a generic placeholder when no executive is assigned', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      versions.findById.mockResolvedValue(
        buildVersion({
          htmlContent: '<p>Saludos, {nombre} — {cargo_raro}</p>',
          plainTextContent: 'Saludos, {nombre} — {cargo_raro}',
        }),
      );
      assignments.findByMailbox.mockResolvedValue([]);

      const result = await service.preview(orgId, 'mailbox_1');

      expect(result.variables).toEqual(['nombre', 'cargo_raro']);
      expect(result.renderedHtml).toContain('Juan Pérez');
      expect(result.renderedHtml).toContain('[valor de ejemplo]');
      expect(result.renderedHtml).not.toContain('{nombre}');
      expect(result.usesRealSenderData).toBe(false);
    });

    it('uses the real assigned executive for {sender.*} variables when one exists', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      versions.findById.mockResolvedValue(
        buildVersion({
          htmlContent: '<p>{sender.name} — {sender.email}</p>',
          plainTextContent: '{sender.name} — {sender.email}',
        }),
      );
      assignments.findByMailbox.mockResolvedValue([buildAssignment()]);
      users.findById.mockResolvedValue(buildUser());

      const result = await service.preview(orgId, 'mailbox_1');

      expect(result.renderedHtml).toContain('María Pérez');
      expect(result.renderedHtml).toContain('maria@example.com');
      expect(result.usesRealSenderData).toBe(true);
    });

    it('throws NotFoundException when there is no active version', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: null }));

      await expect(service.preview(orgId, 'mailbox_1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('sendTest', () => {
    it('decrypts the SMTP secret, sends through the engine client, and audits without leaking the recipient or content', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      versions.findById.mockResolvedValue(buildVersion());
      assignments.findByMailbox.mockResolvedValue([]);
      engineClient.sendMail.mockResolvedValue({ accepted: true, messageId: 'msg_1' });

      const result = await service.sendTest(orgId, 'mailbox_1', 'destino@example.com', 'actor_1');

      expect(secrets.decrypt).toHaveBeenCalledWith('iv.tag.cipher');
      const callArg = engineClient.sendMail.mock.calls[0][0];
      expect(callArg.smtp.password).toBe('decrypted-password');
      expect(callArg.to).toBe('destino@example.com');
      expect(callArg.subject).toBe('Prueba de firma');
      expect(result.accepted).toBe(true);

      const auditCall = auditLogs.record.mock.calls.find(
        (call) => call[0].action === 'signature.test_send',
      );
      expect(auditCall).toBeDefined();
      expect(JSON.stringify(auditCall![0])).not.toContain('destino@example.com');
    });

    it('reports a rejection from the engine client without throwing', async () => {
      mailboxes.findById.mockResolvedValue(buildMailbox());
      signatures.findByMailbox.mockResolvedValue(buildSignature({ activeVersionId: 'version_1' }));
      versions.findById.mockResolvedValue(buildVersion());
      assignments.findByMailbox.mockResolvedValue([]);
      engineClient.sendMail.mockResolvedValue({
        accepted: false,
        errorCode: 'SMTP_RECIPIENT_REJECTED',
      });

      const result = await service.sendTest(orgId, 'mailbox_1', 'destino@example.com', 'actor_1');

      expect(result.accepted).toBe(false);
      expect(result.message).toContain('SMTP_RECIPIENT_REJECTED');
    });
  });
});
