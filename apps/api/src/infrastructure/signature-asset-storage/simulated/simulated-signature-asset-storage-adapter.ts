import { Injectable } from '@nestjs/common';
import { mkdir, unlink, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import {
  SignatureAssetStoragePort,
  UploadedSignatureAsset,
  UploadSignatureAssetInput,
} from '../../../domain/signature-asset-storage/signature-asset-storage.port';

/**
 * Dev/test adapter (SIGNATURE_ASSET_STORAGE_MODE=simulated, the default).
 * Reuses the SAME `<repo>/apps/api/uploads` static mount main.ts already
 * serves at `/uploads/*` for the generic image-storage port — writing
 * under the `signatures/` prefix keeps the two features' files apart
 * without needing a second static mount or a dedicated dev-only
 * controller route. Never selected in production (see
 * .env.production.example, which sets SIGNATURE_ASSET_STORAGE_MODE=r2).
 */
@Injectable()
export class SimulatedSignatureAssetStorageAdapter implements SignatureAssetStoragePort {
  private readonly uploadsRoot = join(process.cwd(), 'uploads');

  constructor(private readonly config: AppConfigService) {}

  async uploadImage(input: UploadSignatureAssetInput): Promise<UploadedSignatureAsset> {
    const objectKey = `signatures/${input.organizationId}/${input.ownerUserId}/${input.assetId}.${input.extension}`;
    const filePath = join(this.uploadsRoot, objectKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.buffer);
    return { objectKey, publicUrl: this.getPublicUrl(objectKey) };
  }

  getPublicUrl(objectKey: string): string {
    return `${this.config.apiPublicUrl}/uploads/${objectKey}`;
  }

  async deleteUnreferencedImage(objectKey: string): Promise<void> {
    await unlink(join(this.uploadsRoot, objectKey)).catch(() => undefined);
  }

  async validateAssetExistence(objectKey: string): Promise<boolean> {
    return access(join(this.uploadsRoot, objectKey))
      .then(() => true)
      .catch(() => false);
  }
}
