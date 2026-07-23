import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import {
  ImageStoragePort,
  StoreImageInput,
  StoredImage,
} from '../../../domain/storage/image-storage.port';

/**
 * Dev/default adapter (STORAGE_DRIVER=local, or unset). Writes under
 * <repo>/apps/api/uploads/<organizationId>/<uuid>.<ext> and relies on
 * main.ts serving that directory at the /uploads/* prefix — no database
 * row, no base64-in-DB, just files on disk plus the public URL that
 * points at them (see ImageStoragePort's comment on why the URL must be
 * public: recipients' mail clients fetch it unauthenticated).
 */
@Injectable()
export class LocalImageStorageAdapter implements ImageStoragePort {
  private readonly uploadsRoot = join(process.cwd(), 'uploads');

  constructor(private readonly config: AppConfigService) {}

  async store(input: StoreImageInput): Promise<StoredImage> {
    const dir = join(this.uploadsRoot, input.organizationId);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.${input.extension}`;
    await writeFile(join(dir, filename), input.buffer);

    const key = `${input.organizationId}/${filename}`;
    return { key, url: `${this.config.apiPublicUrl}/uploads/${key}` };
  }
}
