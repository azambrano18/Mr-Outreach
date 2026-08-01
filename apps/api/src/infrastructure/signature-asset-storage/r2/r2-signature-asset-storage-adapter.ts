import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { AppConfigService } from '../../config/app-config.service';
import {
  SignatureAssetAccessDenied,
  SignatureAssetStorageUnavailable,
  SignatureAssetUploadFailed,
} from '../../../domain/signature-asset-storage/signature-asset-storage.errors';
import {
  DeleteObjectsByPrefixResult,
  SignatureAssetHeadResult,
  SignatureAssetStoragePort,
  UploadedSignatureAsset,
  UploadSignatureAssetInput,
} from '../../../domain/signature-asset-storage/signature-asset-storage.port';

/** Immutable per §7 — an asset object key is never reused/overwritten, so a very long, cacheable lifetime is safe. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** S3/R2's own hard limit per DeleteObjects call — §8 requires supporting batches larger than this via pagination. */
const DELETE_BATCH_SIZE = 1000;

/**
 * Production adapter (SIGNATURE_ASSET_STORAGE_MODE=r2). Talks to Cloudflare
 * R2 through its S3-compatible API via `@aws-sdk/client-s3` — R2 requires
 * no extra SDK, only a custom `endpoint` and `region: "auto"` (see
 * https://developers.cloudflare.com/r2/api/s3/api/).
 *
 * The `S3Client` is built lazily (see `client` getter) and ONLY the first
 * time one of uploadImage/deleteUnreferencedImage/validateAssetExistence/
 * deleteObjectsByPrefix actually runs — never in the constructor, and
 * therefore never at all when `SIGNATURE_ASSET_STORAGE_MODE=simulated`
 * (Nest still instantiates this class as a provider in every mode, since
 * `SignatureAssetStorageModule` picks the active port at factory time, but
 * a class merely existing must never open a network client that mode
 * doesn't need).
 */
@Injectable()
export class R2SignatureAssetStorageAdapter implements SignatureAssetStoragePort {
  private readonly logger = new Logger(R2SignatureAssetStorageAdapter.name);
  private cachedClient: S3Client | null = null;

  constructor(private readonly config: AppConfigService) {}

  private get client(): S3Client {
    if (!this.cachedClient) {
      this.cachedClient = new S3Client({
        region: 'auto',
        endpoint: `https://${this.config.r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.config.r2AccessKeyId as string,
          secretAccessKey: this.config.r2SecretAccessKey as string,
        },
      });
    }
    return this.cachedClient;
  }

  async uploadImage(input: UploadSignatureAssetInput): Promise<UploadedSignatureAsset> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.r2BucketName,
          Key: input.objectKey,
          Body: input.buffer,
          ContentType: input.contentType,
          ContentLength: input.buffer.length,
          CacheControl: IMMUTABLE_CACHE_CONTROL,
        }),
      );
    } catch (error) {
      throw this.toSanitizedError(error, 'uploadImage', input.objectKey);
    }

    return { objectKey: input.objectKey, publicUrl: this.getPublicUrl(input.objectKey) };
  }

  getPublicUrl(objectKey: string): string {
    const base = this.config.r2PublicBaseUrl.replace(/\/+$/, '');
    const key = objectKey.replace(/^\/+/, '');
    return `${base}/${key}`;
  }

  async deleteUnreferencedImage(objectKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.r2BucketName, Key: objectKey }));
    } catch (error) {
      // Idempotent: an object that's already gone is not an error for this operation's caller.
      if (isNotFoundError(error)) return;
      throw this.toSanitizedError(error, 'deleteUnreferencedImage', objectKey);
    }
  }

  async validateAssetExistence(objectKey: string): Promise<SignatureAssetHeadResult> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.r2BucketName, Key: objectKey }));
      return {
        exists: true,
        contentType: result.ContentType,
        sizeBytes: result.ContentLength,
        etag: result.ETag,
        lastModified: result.LastModified?.toISOString(),
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { exists: false };
      }
      throw this.toSanitizedError(error, 'validateAssetExistence', objectKey);
    }
  }

  /**
   * Fase 2 (R2), §8/§20-22 — lists every object under `prefix` via
   * paginated ListObjectsV2 (following `NextContinuationToken` until
   * exhausted, so this supports more than 1,000 objects), then deletes them
   * in batches of at most 1,000 keys via DeleteObjects (S3/R2's own hard
   * limit per call). A prefix with zero objects is a successful no-op,
   * never an error — idempotent, safe to retry after a partial failure
   * (deleting an already-gone object is never an error either).
   */
  async deleteObjectsByPrefix(prefix: string): Promise<DeleteObjectsByPrefixResult> {
    let deletedCount = 0;
    let continuationToken: string | undefined;

    try {
      do {
        const listed = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.config.r2BucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        const keys = (listed.Contents ?? []).map((object) => object.Key).filter((key): key is string => Boolean(key));

        for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
          const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
          if (batch.length === 0) continue;
          await this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.config.r2BucketName,
              Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true },
            }),
          );
          deletedCount += batch.length;
        }

        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (error) {
      throw this.toSanitizedError(error, 'deleteObjectsByPrefix', prefix);
    }

    return { deletedCount };
  }

  /**
   * §12 — the ONLY place a raw AWS SDK error is ever inspected in this
   * adapter. Logs a normalized, credential-free summary; throws a
   * sanitized domain error that never carries the SDK's own message,
   * headers, or stack trace to the caller.
   */
  private toSanitizedError(error: unknown, operation: string, objectKey: string): Error {
    const code = errorCode(error);
    this.logger.warn(
      JSON.stringify({ event: 'signature_asset_storage.r2_error', operation, objectKey, code }),
    );

    if (isAccessDeniedError(error)) {
      return new SignatureAssetAccessDenied();
    }
    if (operation === 'uploadImage') {
      return new SignatureAssetUploadFailed();
    }
    return new SignatureAssetStorageUnavailable();
  }
}

function errorCode(error: unknown): string {
  if (error instanceof S3ServiceException) {
    return error.name || String(error.$metadata?.httpStatusCode ?? 'UNKNOWN');
  }
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as { name?: unknown }).name);
  }
  return 'UNKNOWN';
}

function isNotFoundError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === 'NoSuchKey' || code === 'NotFound') return true;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode;
  return status === 404;
}

function isAccessDeniedError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === 'AccessDenied' || code === 'Forbidden' || code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') {
    return true;
  }
  const status = (error as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode;
  return status === 401 || status === 403;
}
