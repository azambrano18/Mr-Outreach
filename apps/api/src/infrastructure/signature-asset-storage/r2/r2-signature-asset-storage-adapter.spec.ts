import { AppConfigService } from '../../config/app-config.service';
import {
  SignatureAssetAccessDenied,
  SignatureAssetStorageUnavailable,
  SignatureAssetUploadFailed,
} from '../../../domain/signature-asset-storage/signature-asset-storage.errors';

const sendMock = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

// Imported AFTER the mock so the adapter picks up the mocked S3Client constructor.
import { S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { R2SignatureAssetStorageAdapter } from './r2-signature-asset-storage-adapter';

function s3Error(name: string, httpStatusCode: number): S3ServiceException {
  const error = new S3ServiceException({
    name,
    $fault: 'client',
    $metadata: { httpStatusCode },
    message: `${name} from AWS SDK — includes sensitive internals that must never reach the caller`,
  });
  return error;
}

describe('R2SignatureAssetStorageAdapter — Fase Firma, R2 real PutObject/HeadObject/DeleteObject', () => {
  let config: Pick<
    AppConfigService,
    'r2AccountId' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName' | 'r2PublicBaseUrl' | 'r2SignaturePrefix'
  >;
  let adapter: R2SignatureAssetStorageAdapter;

  const orgId = 'org_1';
  const userId = 'user_1';
  const assetId = 'asset_1';

  beforeEach(() => {
    sendMock.mockReset();
    (S3Client as unknown as jest.Mock).mockClear();
    config = {
      r2AccountId: 'acct_123',
      r2AccessKeyId: 'ak_123',
      r2SecretAccessKey: 'sk_123_super_secret',
      r2BucketName: 'mr-outreach-assets',
      r2PublicBaseUrl: 'https://assets.mejoreferido.com',
      r2SignaturePrefix: 'signatures',
    };
    adapter = new R2SignatureAssetStorageAdapter(config as unknown as AppConfigService);
  });

  describe('uploadImage — PutObject', () => {
    it('sends PutObjectCommand with Bucket/Key/Body/ContentType/ContentLength/CacheControl', async () => {
      sendMock.mockResolvedValueOnce({});
      const buffer = Buffer.from('fake-png-bytes');

      const result = await adapter.uploadImage({
        organizationId: orgId,
        ownerUserId: userId,
        assetId,
        buffer,
        contentType: 'image/png',
        extension: 'png',
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const command = sendMock.mock.calls[0][0];
      expect(command.input).toEqual(
        expect.objectContaining({
          Bucket: 'mr-outreach-assets',
          Key: `signatures/${orgId}/${userId}/${assetId}.png`,
          Body: buffer,
          ContentType: 'image/png',
          ContentLength: buffer.length,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      expect(result.objectKey).toBe(`signatures/${orgId}/${userId}/${assetId}.png`);
      expect(result.publicUrl).toBe(`https://assets.mejoreferido.com/signatures/${orgId}/${userId}/${assetId}.png`);
    });

    it('never includes an ACL parameter', async () => {
      sendMock.mockResolvedValueOnce({});
      await adapter.uploadImage({
        organizationId: orgId,
        ownerUserId: userId,
        assetId,
        buffer: Buffer.from('x'),
        contentType: 'image/png',
        extension: 'png',
      });
      const command = sendMock.mock.calls[0][0];
      expect(command.input.ACL).toBeUndefined();
    });

    it('two uploads for the same user produce different assetIds, objectKeys and URLs — never overwrites', async () => {
      sendMock.mockResolvedValue({});
      const first = await adapter.uploadImage({
        organizationId: orgId,
        ownerUserId: userId,
        assetId: 'asset_a',
        buffer: Buffer.from('x'),
        contentType: 'image/png',
        extension: 'png',
      });
      const second = await adapter.uploadImage({
        organizationId: orgId,
        ownerUserId: userId,
        assetId: 'asset_b',
        buffer: Buffer.from('y'),
        contentType: 'image/png',
        extension: 'png',
      });
      expect(first.objectKey).not.toBe(second.objectKey);
      expect(first.publicUrl).not.toBe(second.publicUrl);
    });

    it('throws a sanitized SignatureAssetUploadFailed (never the raw SDK error) when PutObject fails, and never returns a URL', async () => {
      sendMock.mockRejectedValueOnce(s3Error('InternalError', 500));
      await expect(
        adapter.uploadImage({
          organizationId: orgId,
          ownerUserId: userId,
          assetId,
          buffer: Buffer.from('x'),
          contentType: 'image/png',
          extension: 'png',
        }),
      ).rejects.toBeInstanceOf(SignatureAssetUploadFailed);
    });

    it('never leaks the access key or secret key in the thrown error message', async () => {
      sendMock.mockRejectedValueOnce(s3Error('InternalError', 500));
      try {
        await adapter.uploadImage({
          organizationId: orgId,
          ownerUserId: userId,
          assetId,
          buffer: Buffer.from('x'),
          contentType: 'image/png',
          extension: 'png',
        });
        fail('expected uploadImage to throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(config.r2AccessKeyId);
        expect(message).not.toContain(config.r2SecretAccessKey);
        expect(message).not.toMatch(/sensitive internals/);
      }
    });

    it('builds the S3Client lazily with region "auto" and the account-scoped R2 endpoint, only when actually uploading', async () => {
      expect(S3Client).not.toHaveBeenCalled(); // constructing the adapter alone must never build the client
      sendMock.mockResolvedValueOnce({});
      await adapter.uploadImage({
        organizationId: orgId,
        ownerUserId: userId,
        assetId,
        buffer: Buffer.from('x'),
        contentType: 'image/png',
        extension: 'png',
      });
      expect(S3Client).toHaveBeenCalledTimes(1);
      const clientConfig = (S3Client as unknown as jest.Mock).mock.calls[0][0];
      expect(clientConfig.region).toBe('auto');
      expect(clientConfig.endpoint).toBe('https://acct_123.r2.cloudflarestorage.com');
      expect(clientConfig.credentials).toEqual({ accessKeyId: 'ak_123', secretAccessKey: 'sk_123_super_secret' });
    });
  });

  describe('validateAssetExistence — HeadObject', () => {
    const objectKey = `signatures/${orgId}/${userId}/${assetId}.png`;

    it('confirms existence and returns contentType/size/etag/lastModified', async () => {
      const lastModified = new Date('2026-01-01T00:00:00.000Z');
      sendMock.mockResolvedValueOnce({ ContentType: 'image/png', ContentLength: 12345, ETag: '"abc"', LastModified: lastModified });
      const result = await adapter.validateAssetExistence(objectKey);
      expect(result).toEqual({
        exists: true,
        contentType: 'image/png',
        sizeBytes: 12345,
        etag: '"abc"',
        lastModified: lastModified.toISOString(),
      });
    });

    it('detects a 404/NoSuchKey as exists:false, never throwing', async () => {
      sendMock.mockRejectedValueOnce(s3Error('NoSuchKey', 404));
      await expect(adapter.validateAssetExistence(objectKey)).resolves.toEqual({ exists: false });
    });

    it('distinguishes 403 access-denied from a genuine 404 — throws SignatureAssetAccessDenied, never exists:false', async () => {
      sendMock.mockRejectedValueOnce(s3Error('AccessDenied', 403));
      await expect(adapter.validateAssetExistence(objectKey)).rejects.toBeInstanceOf(SignatureAssetAccessDenied);
    });

    it('distinguishes a technical failure (5xx/timeout) from a genuine 404 — throws SignatureAssetStorageUnavailable', async () => {
      sendMock.mockRejectedValueOnce(s3Error('InternalError', 500));
      await expect(adapter.validateAssetExistence(objectKey)).rejects.toBeInstanceOf(SignatureAssetStorageUnavailable);
    });
  });

  describe('deleteUnreferencedImage — DeleteObject', () => {
    const objectKey = `signatures/${orgId}/${userId}/${assetId}.png`;

    it('sends DeleteObjectCommand with the correct Bucket/Key', async () => {
      sendMock.mockResolvedValueOnce({});
      await adapter.deleteUnreferencedImage(objectKey);
      const command = sendMock.mock.calls[0][0];
      expect(command.input).toEqual({ Bucket: 'mr-outreach-assets', Key: objectKey });
    });

    it('is idempotent — a NoSuchKey/404 on delete resolves successfully instead of throwing', async () => {
      sendMock.mockRejectedValueOnce(s3Error('NoSuchKey', 404));
      await expect(adapter.deleteUnreferencedImage(objectKey)).resolves.toBeUndefined();
    });

    it('throws a sanitized error for a genuine technical failure', async () => {
      sendMock.mockRejectedValueOnce(s3Error('InternalError', 500));
      await expect(adapter.deleteUnreferencedImage(objectKey)).rejects.toBeInstanceOf(SignatureAssetStorageUnavailable);
    });
  });

  describe('getPublicUrl', () => {
    it('joins R2_PUBLIC_BASE_URL and the objectKey with exactly one slash', () => {
      expect(adapter.getPublicUrl('signatures/org/user/asset.png')).toBe(
        'https://assets.mejoreferido.com/signatures/org/user/asset.png',
      );
    });

    it('normalizes a trailing slash on the base URL', () => {
      (config as any).r2PublicBaseUrl = 'https://assets.mejoreferido.com/';
      const withTrailingSlash = new R2SignatureAssetStorageAdapter(config as unknown as AppConfigService);
      expect(withTrailingSlash.getPublicUrl('signatures/org/user/asset.png')).toBe(
        'https://assets.mejoreferido.com/signatures/org/user/asset.png',
      );
    });

    it('never embeds credentials in the public URL', () => {
      const url = adapter.getPublicUrl('signatures/org/user/asset.png');
      expect(url).not.toContain(config.r2AccessKeyId);
      expect(url).not.toContain(config.r2SecretAccessKey);
    });
  });
});
