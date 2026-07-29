import { BadRequestException } from '@nestjs/common';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SignatureAssetRepository } from '../../domain/signature-asset/signature-asset.repository';
import { SignatureAssetStoragePort } from '../../domain/signature-asset-storage/signature-asset-storage.port';
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

describe('SignatureAssetsService — Fase Firma', () => {
  let assets: jest.Mocked<Pick<SignatureAssetRepository, 'create' | 'findByOrganization' | 'update'>>;
  let storage: jest.Mocked<Pick<SignatureAssetStoragePort, 'uploadImage'>>;
  let audit: jest.Mocked<Pick<AuditLogRepository, 'record'>>;
  let service: SignatureAssetsService;

  const orgId = 'org_1';
  const userId = 'exec_1';

  beforeEach(() => {
    assets = {
      create: jest.fn().mockImplementation(async (input) => ({ ...input, status: 'AVAILABLE', createdAt: new Date(), deletedAt: null })),
      findByOrganization: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    };
    storage = {
      uploadImage: jest.fn().mockImplementation(async (input) => ({
        objectKey: `signatures/${input.organizationId}/${input.ownerUserId}/${input.assetId}.${input.extension}`,
        publicUrl: `https://assets.mejoreferido.com/signatures/${input.organizationId}/${input.ownerUserId}/${input.assetId}.${input.extension}`,
      })),
    };
    audit = { record: jest.fn() };
    service = new SignatureAssetsService(
      assets as unknown as SignatureAssetRepository,
      storage as unknown as SignatureAssetStoragePort,
      audit as unknown as AuditLogRepository,
    );
  });

  it('§4-5 — accepts a valid PNG within size/dimension limits and returns the public URL, no base64', async () => {
    const result = await service.upload(orgId, userId, {
      buffer: pngWithSize(240, 90),
      originalFileName: 'logo.png',
    });
    expect(result.publicUrl).toMatch(/^https:\/\/assets\.mejoreferido\.com\/signatures\//);
    expect(result.width).toBe(240);
    expect(result.height).toBe(90);
    expect(result.contentType).toBe('image/png');
    expect(JSON.stringify(result)).not.toMatch(/base64/);
  });

  it('rejects an empty file', async () => {
    await expect(service.upload(orgId, userId, { buffer: Buffer.alloc(0), originalFileName: 'x.png' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('§5 — rejects a file over 1 MB', async () => {
    const oversized = Buffer.concat([pngWithSize(100, 100), Buffer.alloc(1024 * 1024 + 1)]);
    await expect(
      service.upload(orgId, userId, { buffer: oversized, originalFileName: 'big.png' }),
    ).rejects.toThrow(/tamaño máximo/);
  });

  it('§5 — rejects an image wider than 1200px', async () => {
    await expect(
      service.upload(orgId, userId, { buffer: pngWithSize(1201, 100), originalFileName: 'wide.png' }),
    ).rejects.toThrow(/1200x500/);
  });

  it('§5 — rejects an image taller than 500px', async () => {
    await expect(
      service.upload(orgId, userId, { buffer: pngWithSize(100, 501), originalFileName: 'tall.png' }),
    ).rejects.toThrow(/1200x500/);
  });

  it('§5 — rejects WebP even though the underlying sniffer recognizes it as a real image', async () => {
    await expect(
      service.upload(orgId, userId, { buffer: webpBuffer(), originalFileName: 'x.webp' }),
    ).rejects.toThrow(/PNG, JPG o GIF/);
  });

  it('rejects a renamed non-image file regardless of its extension (magic-byte validation, not filename/Content-Type)', async () => {
    await expect(
      service.upload(orgId, userId, { buffer: Buffer.from('<html>not an image</html>'), originalFileName: 'fake.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('generates an immutable objectKey scoped to organization/user/assetId, and the SignatureAsset row shares that same id', async () => {
    const result = await service.upload(orgId, userId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    const createCall = assets.create.mock.calls[0][0];
    expect(createCall.id).toBe(result.assetId);
    expect(createCall.objectKey).toBe(`signatures/${orgId}/${userId}/${result.assetId}.png`);
  });

  it('replacing an image (uploading again) always produces a brand-new assetId/objectKey/URL — never reuses one', async () => {
    const first = await service.upload(orgId, userId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    const second = await service.upload(orgId, userId, { buffer: pngWithSize(60, 60), originalFileName: 'logo-v2.png' });
    expect(first.assetId).not.toBe(second.assetId);
    expect(first.publicUrl).not.toBe(second.publicUrl);
  });

  it('sanitizes a path-like original file name down to a safe base name', async () => {
    await service.upload(orgId, userId, { buffer: pngWithSize(50, 50), originalFileName: '../../etc/evil<script>.png' });
    const createCall = assets.create.mock.calls[0][0];
    expect(createCall.originalFileName).not.toContain('/');
    expect(createCall.originalFileName).not.toContain('<');
  });

  it('audits the upload without leaking the binary content or storage credentials', async () => {
    await service.upload(orgId, userId, { buffer: pngWithSize(50, 50), originalFileName: 'logo.png' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, actorId: userId, action: 'signature_asset.upload' }),
    );
    const metadata = audit.record.mock.calls[0][0].metadata;
    expect(JSON.stringify(metadata)).not.toMatch(/base64|R2_SECRET|accessKey/i);
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
