import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { SignatureAssetRepository } from '../../domain/signature-asset/signature-asset.repository';
import {
  SignatureAssetStoragePort,
} from '../../domain/signature-asset-storage/signature-asset-storage.port';
import { AUDIT_LOG_REPOSITORY, SIGNATURE_ASSET_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { getImageDimensions } from '../../infrastructure/signature-asset-storage/image-dimensions';
import { SIGNATURE_ASSET_STORAGE_PORT } from '../../infrastructure/signature-asset-storage/tokens';
import { sniffImageType } from '../../infrastructure/storage/image-mime-sniffer';
import { SignatureAssetSummary } from './signature-assets.types';

/** §5 — 1 MB per image; the editor's inserted width can never exceed 600px, but the SOURCE file is allowed up to 1200x500. */
const MAX_SIZE_BYTES = 1 * 1024 * 1024;
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 500;

export interface UploadSignatureAssetFile {
  buffer: Buffer;
  originalFileName: string;
}

/**
 * §4-6 — validates a signature image upload (real magic bytes, never the
 * declared Content-Type/extension; format/size/dimension limits) then
 * delegates the actual write to whichever SignatureAssetStoragePort
 * adapter is active, and records an ownership/traceability row. Never
 * touches SequenceTemplate/SequenceTemplateVersion — the caller inserts
 * the returned `publicUrl` into the template's own signatureHtml
 * afterward, exactly like any other hosted asset.
 */
@Injectable()
export class SignatureAssetsService {
  constructor(
    @Inject(SIGNATURE_ASSET_REPOSITORY) private readonly assets: SignatureAssetRepository,
    @Inject(SIGNATURE_ASSET_STORAGE_PORT) private readonly storage: SignatureAssetStoragePort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
  ) {}

  async upload(
    organizationId: string,
    ownerUserId: string,
    file: UploadSignatureAssetFile,
  ): Promise<SignatureAssetSummary> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    if (file.buffer.length > MAX_SIZE_BYTES) {
      throw new BadRequestException('La imagen supera el tamaño máximo permitido (1 MB).');
    }

    const sniffed = sniffImageType(file.buffer);
    if (!sniffed || sniffed.mimeType === 'image/webp') {
      throw new BadRequestException('Formato de imagen no soportado. Usa PNG, JPG o GIF.');
    }

    const dimensions = getImageDimensions(file.buffer, sniffed.mimeType);
    if (!dimensions) {
      throw new BadRequestException('No se pudo determinar el tamaño de la imagen.');
    }
    if (dimensions.width > MAX_WIDTH || dimensions.height > MAX_HEIGHT) {
      throw new BadRequestException(
        `La imagen supera el tamaño máximo permitido (${MAX_WIDTH}x${MAX_HEIGHT} px).`,
      );
    }

    const assetId = randomUUID();
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const uploaded = await this.storage.uploadImage({
      organizationId,
      ownerUserId,
      assetId,
      buffer: file.buffer,
      contentType: sniffed.mimeType,
      extension: sniffed.extension,
    });

    const asset = await this.assets.create({
      id: assetId,
      organizationId,
      ownerUserId,
      objectKey: uploaded.objectKey,
      publicUrl: uploaded.publicUrl,
      contentType: sniffed.mimeType,
      originalFileName: sanitizeFileName(file.originalFileName),
      sizeBytes: file.buffer.length,
      width: dimensions.width,
      height: dimensions.height,
      sha256,
    });

    await this.audit.record({
      organizationId,
      actorId: ownerUserId,
      action: 'signature_asset.upload',
      entityType: 'SignatureAsset',
      entityId: asset.id,
      // Never the binary content, never the storage credentials — only the outcome.
      metadata: { contentType: asset.contentType, sizeBytes: asset.sizeBytes, width: asset.width, height: asset.height },
    });

    return {
      assetId: asset.id,
      publicUrl: asset.publicUrl,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
    };
  }

  /**
   * §13 — a manual/cron-ready hook, not an automatic background job (this
   * codebase runs no scheduler/worker process at all, see README): marks
   * AVAILABLE assets older than `olderThanDays` as ORPHANED. Never
   * physically deletes anything itself — a REFERENCED asset (already used
   * by a draft, a published version, or a Gestión) is never touched here.
   */
  async markStaleAvailableAssetsOrphaned(organizationId: string, olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const candidates = (await this.assets.findByOrganization(organizationId)).filter(
      (asset) => asset.status === 'AVAILABLE' && asset.createdAt < cutoff,
    );
    for (const asset of candidates) {
      await this.assets.update(asset.id, { status: 'ORPHANED' });
    }
    return candidates.length;
  }
}

/** Keeps only a safe base name for display — never a path, never a directory traversal. */
function sanitizeFileName(rawName: string): string {
  const base = rawName.split(/[/\\]/).pop() ?? 'imagen';
  return base.replace(/[^\w.\-\s]/g, '').slice(0, 120) || 'imagen';
}
