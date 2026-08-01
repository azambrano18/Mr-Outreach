import { Injectable } from '@nestjs/common';
import { mkdir, unlink, writeFile, stat, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import {
  DeleteObjectsByPrefixResult,
  SignatureAssetHeadResult,
  SignatureAssetStoragePort,
  UploadedSignatureAsset,
  UploadSignatureAssetInput,
} from '../../../domain/signature-asset-storage/signature-asset-storage.port';

/**
 * Dev/test adapter (SIGNATURE_ASSET_STORAGE_MODE=simulated, the default).
 * Reuses the SAME `<repo>/apps/api/uploads` static mount main.ts already
 * serves at `/uploads/*` for the generic image-storage port — writing
 * under the caller-provided `objectKey` (e.g. `firmas/...` or
 * `email-body/...`) keeps every asset kind's files apart without needing a
 * second static mount or a dedicated dev-only controller route. Never
 * selected in production (see .env.production.example, which sets
 * SIGNATURE_ASSET_STORAGE_MODE=r2).
 */
@Injectable()
export class SimulatedSignatureAssetStorageAdapter implements SignatureAssetStoragePort {
  private readonly uploadsRoot = join(process.cwd(), 'uploads');

  constructor(private readonly config: AppConfigService) {}

  async uploadImage(input: UploadSignatureAssetInput): Promise<UploadedSignatureAsset> {
    const filePath = join(this.uploadsRoot, input.objectKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.buffer);
    return { objectKey: input.objectKey, publicUrl: this.getPublicUrl(input.objectKey) };
  }

  getPublicUrl(objectKey: string): string {
    const base = this.config.apiPublicUrl.replace(/\/+$/, '');
    const key = objectKey.replace(/^\/+/, '');
    return `${base}/uploads/${key}`;
  }

  async deleteUnreferencedImage(objectKey: string): Promise<void> {
    await unlink(join(this.uploadsRoot, objectKey)).catch(() => undefined);
  }

  async validateAssetExistence(objectKey: string): Promise<SignatureAssetHeadResult> {
    try {
      const info = await stat(join(this.uploadsRoot, objectKey));
      return { exists: true, sizeBytes: info.size, lastModified: info.mtime.toISOString() };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Local-disk equivalent of a paginated ListObjectsV2 + DeleteObjects: a
   * recursive file count followed by a single recursive directory removal.
   * A prefix directory that never existed locally counts as zero deleted,
   * never an error — same idempotency contract as the R2 adapter.
   */
  async deleteObjectsByPrefix(prefix: string): Promise<DeleteObjectsByPrefixResult> {
    const dirPath = join(this.uploadsRoot, prefix);
    const fileCount = await countFilesRecursively(dirPath);
    if (fileCount > 0) {
      await rm(dirPath, { recursive: true, force: true });
    }
    return { deletedCount: fileCount };
  }
}

async function countFilesRecursively(dirPath: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFilesRecursively(join(dirPath, entry.name));
    } else {
      count += 1;
    }
  }
  return count;
}
