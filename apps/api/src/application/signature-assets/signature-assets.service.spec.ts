import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SignatureAssetRepository } from '../../domain/signature-asset/signature-asset.repository';
import { SignatureAssetStoragePort } from '../../domain/signature-asset-storage/signature-asset-storage.port';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { SignatureAssetsService } from './signature-assets.service';

function pngWithSize(width: number, height: number): Buffer {
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

function webpBuffer(): Buffer {
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')]);
}

describe('SignatureAssetsService — Fase Firma / Fase 2 (R2)', () => {
  let assets: jest.Mocked<Pick<SignatureAssetRepository, 'create' | 'findByOrganization' | 'update' | 'findById'>>;
  let storage: jest.Mocked<Pick<SignatureAssetStoragePort, 'uploadImage' | 'deleteUnreferencedImage'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let templates: jest.Mocked<Pick<SequenceTemplateRepository, 'findByOwner' | 'findByMailbox'>>;
  let templateVersions: jest.Mocked<Pick<SequenceTemplateVersionRepository, 'findByTemplate'>>;
  let mailboxes: jest.Mocked<Pick<MailboxRepository, 'findById'>>;
  let assignments: jest.Mocked<Pick<MailboxAssignmentRepository, 'findByUser'>>;
  let signatures: jest.Mocked<Pick<SignatureRepository, 'findByMailbox'>>;
  let signatureVersions: jest.Mocked<Pick<SignatureVersionRepository, 'findBySignature'>>;
  let config: Pick<AppConfigService, 'r2SignaturePrefix'>;
  let service: SignatureAssetsService;

  const orgId = 'org_1';
  const userId = 'exec_1';
  const mailboxId = 'mailbox_1';
  const mailbox = { id: mailboxId, organizationId: orgId, email: 'Ventas@Empresa.CL' };

  beforeEach(() => {
    assets = {
      create: jest.fn().mockImplementation(async (input) => ({ ...input, status: 'AVAILABLE', createdAt: new Date(), deletedAt: null })),
      findByOrganization: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      findById: jest.fn(),
    };
    storage = {
      uploadImage: jest.fn().mockImplementation(async (input) => ({
        objectKey: input.objectKey,
        publicUrl: `https://assets.mejoreferido.com/${input.objectKey}`,
      })),
      deleteUnreferencedImage: jest.fn(),
    };
    audit = { record: jest.fn() };
    templates = { findByOwner: jest.fn().mockResolvedValue([]), findByMailbox: jest.fn().mockResolvedValue([]) };
    templateVersions = { findByTemplate: jest.fn().mockResolvedValue([]) };
    mailboxes = { findById: jest.fn().mockResolvedValue(mailbox) };
    assignments = { findByUser: jest.fn().mockResolvedValue([{ mailboxId }]) };
    signatures = { findByMailbox: jest.fn().mockResolvedValue(null) };
    signatureVersions = { findBySignature: jest.fn().mockResolvedValue([]) };
    config = { r2SignaturePrefix: 'firmas' };

    service = new SignatureAssetsService(
      assets as unknown as SignatureAssetRepository,
      storage as unknown as SignatureAssetStoragePort,
      audit as unknown as AuditLogRepository,
      templates as unknown as SequenceTemplateRepository,
      templateVersions as unknown as SequenceTemplateVersionRepository,
      mailboxes as unknown as MailboxRepository,
      assignments as unknown as MailboxAssignmentRepository,
      signatures as unknown as SignatureRepository,
      signatureVersions as unknown as SignatureVersionRepository,
      config as unknown as AppConfigService,
    );
  });

  it('§4-5 — accepts a valid PNG within size/dimension limits, keys it under the mailbox\'s normalized email, and returns the public URL, no base64', async () => {
    const result = await service.upload(orgId, userId, mailboxId, {
      buffer: pngWithSize(240, 90),
      originalFileName: 'logo.png',
    });
    expect(result.publicUrl).toBe(`https://assets.mejoreferido.com/firmas/ventas@empresa.cl/${result.assetId}.png`);
    expect(result.width).toBe(240);
    expect(result.height).toBe(90);
    expect(result.contentType).toBe('image/png');
    expect(JSON.stringify(result)).not.toMatch(/base64/);
  });

  it('404s when the mailbox does not exist or belongs to another organization', async () => {
    mailboxes.findById.mockResolvedValue(null);
    await expect(
      service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uploadForExecutive 404s when the mailbox is not assigned to the caller', async () => {
    assignments.findByUser.mockResolvedValue([]);
    await expect(
      service.uploadForExecutive(orgId, userId, mailboxId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uploadForExecutive succeeds when the mailbox is assigned to the caller', async () => {
    const result = await service.uploadForExecutive(orgId, userId, mailboxId, {
      buffer: pngWithSize(50, 50),
      originalFileName: 'logo.png',
    });
    expect(result.contentType).toBe('image/png');
  });

  it('rejects an empty file', async () => {
    await expect(
      service.upload(orgId, userId, mailboxId, { buffer: Buffer.alloc(0), originalFileName: 'x.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('§5 — rejects a file over 1 MB', async () => {
    const oversized = Buffer.concat([pngWithSize(100, 100), Buffer.alloc(1024 * 1024 + 1)]);
    await expect(
      service.upload(orgId, userId, mailboxId, { buffer: oversized, originalFileName: 'big.png' }),
    ).rejects.toThrow(/tamaño máximo/);
  });

  it('§5 — rejects an image wider than 1200px', async () => {
    await expect(
      service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(1201, 100), originalFileName: 'wide.png' }),
    ).rejects.toThrow(/1200x500/);
  });

  it('§5 — rejects an image taller than 500px', async () => {
    await expect(
      service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(100, 501), originalFileName: 'tall.png' }),
    ).rejects.toThrow(/1200x500/);
  });

  it('§5 — rejects WebP even though the underlying sniffer recognizes it as a real image', async () => {
    await expect(
      service.upload(orgId, userId, mailboxId, { buffer: webpBuffer(), originalFileName: 'x.webp' }),
    ).rejects.toThrow(/PNG, JPG o GIF/);
  });

  it('rejects a renamed non-image file regardless of its extension (magic-byte validation, not filename/Content-Type)', async () => {
    await expect(
      service.upload(orgId, userId, mailboxId, { buffer: Buffer.from('<html>not an image</html>'), originalFileName: 'fake.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('generates an immutable objectKey under firmas/{correo-normalizado}/, and the SignatureAsset row shares that same id', async () => {
    const result = await service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    const createCall = assets.create.mock.calls[0][0];
    expect(createCall.id).toBe(result.assetId);
    expect(createCall.mailboxId).toBe(mailboxId);
    expect(createCall.objectKey).toBe(`firmas/ventas@empresa.cl/${result.assetId}.png`);
  });

  it('normalizes the mailbox email exactly (trim, lowercase) when building the folder', async () => {
    mailboxes.findById.mockResolvedValue({ ...mailbox, email: '  Ventas@Empresa.CL  ' } as any);
    const result = await service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    expect(result.publicUrl).toContain('firmas/ventas@empresa.cl/');
  });

  it('two different mailboxes never share a folder, even with similar emails', async () => {
    const first = await service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    mailboxes.findById.mockResolvedValue({ ...mailbox, id: 'mailbox_2', email: 'ventas2@empresa.cl' } as any);
    const second = await service.upload(orgId, userId, 'mailbox_2', { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    expect(first.publicUrl).toContain('firmas/ventas@empresa.cl/');
    expect(second.publicUrl).toContain('firmas/ventas2@empresa.cl/');
  });

  it('replacing an image (uploading again) always produces a brand-new assetId/objectKey/URL — never reuses one', async () => {
    const first = await service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    const second = await service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(60, 60), originalFileName: 'logo-v2.png' });
    expect(first.assetId).not.toBe(second.assetId);
    expect(first.publicUrl).not.toBe(second.publicUrl);
  });

  it('sanitizes a path-like original file name down to a safe base name', async () => {
    await service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(50, 50), originalFileName: '../../etc/evil<script>.png' });
    const createCall = assets.create.mock.calls[0][0];
    expect(createCall.originalFileName).not.toContain('/');
    expect(createCall.originalFileName).not.toContain('<');
  });

  it('audits the upload with the mailboxId, without leaking the binary content or storage credentials', async () => {
    await service.upload(orgId, userId, mailboxId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, actorId: userId, action: 'signature_asset.upload' }),
    );
    const metadata = audit.record.mock.calls[0][0].metadata as Record<string, unknown>;
    expect(metadata.mailboxId).toBe(mailboxId);
    expect(JSON.stringify(metadata)).not.toMatch(/base64|R2_SECRET|accessKey/i);
  });

  describe('deleteUnreferencedImage — §10', () => {
    const existingAsset = {
      id: 'asset_1',
      organizationId: orgId,
      ownerUserId: userId,
      mailboxId,
      objectKey: `firmas/ventas@empresa.cl/asset_1.png`,
      publicUrl: `https://assets.mejoreferido.com/firmas/ventas@empresa.cl/asset_1.png`,
      contentType: 'image/png',
      originalFileName: 'logo.png',
      sizeBytes: 100,
      width: 50,
      height: 50,
      sha256: 'abc',
      status: 'AVAILABLE',
      createdAt: new Date(),
      deletedAt: null,
    };

    it('404s for an asset that does not exist or belongs to another organization', async () => {
      assets.findById.mockResolvedValue(null);
      await expect(service.deleteUnreferencedImage(orgId, userId, 'ghost')).rejects.toBeInstanceOf(NotFoundException);

      assets.findById.mockResolvedValue({ ...existingAsset, organizationId: 'other_org' } as any);
      await expect(service.deleteUnreferencedImage(orgId, userId, 'asset_1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is idempotent for an already-DELETED asset — never calls the storage port again', async () => {
      assets.findById.mockResolvedValue({ ...existingAsset, status: 'DELETED' } as any);
      await service.deleteUnreferencedImage(orgId, userId, 'asset_1');
      expect(storage.deleteUnreferencedImage).not.toHaveBeenCalled();
    });

    it('rejects deleting an asset still referenced by any version of the mailbox\'s Signature — §16, a replaced image is kept while the account exists', async () => {
      assets.findById.mockResolvedValue(existingAsset as any);
      signatures.findByMailbox.mockResolvedValue({ id: 'sig_1' } as any);
      signatureVersions.findBySignature.mockResolvedValue([
        { id: 'v1', htmlContent: '<p>Vieja</p>' } as any,
        { id: 'v2', htmlContent: `<img src="${existingAsset.publicUrl}">` } as any,
      ]);
      await expect(service.deleteUnreferencedImage(orgId, userId, 'asset_1')).rejects.toBeInstanceOf(ConflictException);
      expect(storage.deleteUnreferencedImage).not.toHaveBeenCalled();
    });

    it('rejects deleting an asset still referenced by an already-published SequenceTemplateVersion — historical content must never lose its image', async () => {
      assets.findById.mockResolvedValue(existingAsset as any);
      templates.findByMailbox.mockResolvedValue([{ id: 'tpl_1' } as any]);
      templateVersions.findByTemplate.mockResolvedValue([
        { id: 'v1', signatureHtml: `<img src="${existingAsset.publicUrl}">` } as any,
      ]);
      await expect(service.deleteUnreferencedImage(orgId, userId, 'asset_1')).rejects.toBeInstanceOf(ConflictException);
      expect(storage.deleteUnreferencedImage).not.toHaveBeenCalled();
    });

    it('deletes the object and marks the row DELETED when truly unreferenced', async () => {
      assets.findById.mockResolvedValue(existingAsset as any);

      await service.deleteUnreferencedImage(orgId, userId, 'asset_1');

      expect(storage.deleteUnreferencedImage).toHaveBeenCalledWith(existingAsset.objectKey);
      expect(assets.update).toHaveBeenCalledWith('asset_1', expect.objectContaining({ status: 'DELETED', deletedAt: expect.any(Date) }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'signature_asset.delete', entityId: 'asset_1' }));
    });

    it('falls back to the legacy owner-based template scan for a pre-Fase-2 asset with no mailboxId', async () => {
      const legacyAsset = { ...existingAsset, mailboxId: null };
      assets.findById.mockResolvedValue(legacyAsset as any);
      templates.findByOwner.mockResolvedValue([{ id: 'tpl_1', signatureHtml: `<img src="${existingAsset.publicUrl}">` } as any]);

      await expect(service.deleteUnreferencedImage(orgId, userId, 'asset_1')).rejects.toBeInstanceOf(ConflictException);
      expect(signatures.findByMailbox).not.toHaveBeenCalled();
    });
  });

  describe('markStaleAvailableAssetsOrphaned — §13', () => {
    it('marks only AVAILABLE assets older than the cutoff as ORPHANED, never a REFERENCED one', async () => {
      const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const recent = new Date();
      assets.findByOrganization.mockResolvedValue([
        { id: 'a1', status: 'AVAILABLE', createdAt: old } as any,
        { id: 'a2', status: 'AVAILABLE', createdAt: recent } as any,
        { id: 'a3', status: 'REFERENCED', createdAt: old } as any,
      ]);
      const count = await service.markStaleAvailableAssetsOrphaned(orgId, 30);
      expect(count).toBe(1);
      expect(assets.update).toHaveBeenCalledWith('a1', { status: 'ORPHANED' });
      expect(assets.update).not.toHaveBeenCalledWith('a2', expect.anything());
      expect(assets.update).not.toHaveBeenCalledWith('a3', expect.anything());
    });
  });
});
