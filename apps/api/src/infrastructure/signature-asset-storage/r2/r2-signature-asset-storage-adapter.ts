import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  SignatureAssetStoragePort,
  UploadedSignatureAsset,
  UploadSignatureAssetInput,
} from '../../../domain/signature-asset-storage/signature-asset-storage.port';

/**
 * Production adapter (SIGNATURE_ASSET_STORAGE_MODE=r2). Same stance this
 * codebase already takes for S3ImageStorageAdapter: the driver exists and
 * is selectable, env validation already refuses to boot without real R2
 * credentials configured (see env.validation.ts), but no bucket has been
 * provisioned in this environment — see docs/signature-assets-r2-setup.md
 * for the external steps a real deploy needs before this can work.
 *
 * `getPublicUrl` needs no network call — it's pure string construction
 * against R2_PUBLIC_BASE_URL, so it's fully implemented now, unlike
 * `uploadImage`/`deleteUnreferencedImage`/`validateAssetExistence`, which
 * need a real signed PutObject/DeleteObject/HeadObject call once
 * `@aws-sdk/client-s3` (R2 is S3-compatible) is added and a bucket exists —
 * nothing else in the app needs to change when that happens.
 */
@Injectable()
export class R2SignatureAssetStorageAdapter implements SignatureAssetStoragePort {
  constructor(private readonly config: AppConfigService) {}

  async uploadImage(_input: UploadSignatureAssetInput): Promise<UploadedSignatureAsset> {
    throw new ServiceUnavailableException(
      'SIGNATURE_ASSET_STORAGE_MODE=r2 is selected but no Cloudflare R2 bucket is configured yet.',
    );
  }

  getPublicUrl(objectKey: string): string {
    return `${this.config.r2PublicBaseUrl}/${objectKey}`;
  }

  async deleteUnreferencedImage(_objectKey: string): Promise<void> {
    throw new ServiceUnavailableException(
      'SIGNATURE_ASSET_STORAGE_MODE=r2 is selected but no Cloudflare R2 bucket is configured yet.',
    );
  }

  async validateAssetExistence(_objectKey: string): Promise<boolean> {
    throw new ServiceUnavailableException(
      'SIGNATURE_ASSET_STORAGE_MODE=r2 is selected but no Cloudflare R2 bucket is configured yet.',
    );
  }
}
