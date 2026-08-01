import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { EmailBodyAssetRepository } from '../../domain/email-body-asset/email-body-asset.repository';
import { SequenceTemplateStepRepository } from '../../domain/sequence-template/sequence-template-step.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { SignatureAssetStoragePort } from '../../domain/signature-asset-storage/signature-asset-storage.port';
import {
  AUDIT_LOG_REPOSITORY,
  EMAIL_BODY_ASSET_REPOSITORY,
  SEQUENCE_TEMPLATE_REPOSITORY,
  SEQUENCE_TEMPLATE_STEP_REPOSITORY,
  SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { getImageDimensions } from '../../infrastructure/signature-asset-storage/image-dimensions';
import { SIGNATURE_ASSET_STORAGE_PORT } from '../../infrastructure/signature-asset-storage/tokens';
import { sniffImageType } from '../../infrastructure/storage/image-mime-sniffer';
import { EmailBodyAssetSummary } from './email-body-assets.types';

/** §12 — 3 MB per image (initial recommended value), 2400x2400 px max. */
const MAX_SIZE_BYTES = 3 * 1024 * 1024;
const MAX_WIDTH = 2400;
const MAX_HEIGHT = 2400;

export interface UploadEmailBodyAssetFile {
  buffer: Buffer;
  originalFileName: string;
}

/**
 * Fase 2 (R2), §7/§10/§24 — validates a body-image upload (real magic
 * bytes, size/dimension limits — same discipline as SignatureAssetsService,
 * a separate implementation only because it's a genuinely different
 * resource/table, not a different set of rules) and stores it under
 * `email-body/{organizationId}/{ownerUserId}/{assetId}.{ext}` — never
 * `firmas/`, never mixed with signature images. Reference-checking scans a
 * step's current draft `bodyHtml` and every already-published
 * SequenceTemplateVersion's frozen per-step snapshot (historical content),
 * never a mailbox's Signature.
 */
@Injectable()
export class EmailBodyAssetsService {
  constructor(
    @Inject(EMAIL_BODY_ASSET_REPOSITORY) private readonly assets: EmailBodyAssetRepository,
    @Inject(SIGNATURE_ASSET_STORAGE_PORT) private readonly storage: SignatureAssetStoragePort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(SEQUENCE_TEMPLATE_REPOSITORY) private readonly templates: SequenceTemplateRepository,
    @Inject(SEQUENCE_TEMPLATE_STEP_REPOSITORY) private readonly steps: SequenceTemplateStepRepository,
    @Inject(SEQUENCE_TEMPLATE_VERSION_REPOSITORY) private readonly templateVersions: SequenceTemplateVersionRepository,
    private readonly config: AppConfigService,
  ) {}

  async upload(organizationId: string, ownerUserId: string, file: UploadEmailBodyAssetFile): Promise<EmailBodyAssetSummary> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    if (file.buffer.length > MAX_SIZE_BYTES) {
      throw new BadRequestException('La imagen supera el tamaño máximo permitido (3 MB).');
    }

    const sniffed = sniffImageType(file.buffer);
    if (!sniffed || sniffed.mimeType === 'image/webp') {
      throw new BadRequestException('El contenido del archivo no corresponde a una imagen PNG, JPG o GIF válida.');
    }

    const dimensions = getImageDimensions(file.buffer, sniffed.mimeType);
    if (!dimensions) {
      throw new BadRequestException('No se pudo determinar el tamaño de la imagen.');
    }
    if (dimensions.width > MAX_WIDTH || dimensions.height > MAX_HEIGHT) {
      throw new BadRequestException(`La imagen del cuerpo no puede superar ${MAX_WIDTH}x${MAX_HEIGHT} píxeles.`);
    }

    const assetId = randomUUID();
    const safePrefix = this.config.r2EmailBodyPrefix.replace(/^\/+|\/+$/g, '');
    const objectKey = `${safePrefix}/${organizationId}/${ownerUserId}/${assetId}.${sniffed.extension}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const uploaded = await this.storage.uploadImage({ objectKey, buffer: file.buffer, contentType: sniffed.mimeType });

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
      action: 'email_body_asset.upload',
      entityType: 'EmailBodyAsset',
      entityId: asset.id,
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

  /** §24 — checked against every step draft and every published version's frozen step snapshot, owned by whoever uploaded it (no cross-executive template editing exists in this codebase). */
  async deleteUnreferencedImage(organizationId: string, actorId: string, assetId: string): Promise<void> {
    const asset = await this.assets.findById(assetId);
    if (!asset || asset.organizationId !== organizationId) {
      throw new NotFoundException('El activo del cuerpo del correo no existe.');
    }
    if (asset.status === 'DELETED') {
      return;
    }

    if (await this.isReferenced(organizationId, asset.ownerUserId, asset.objectKey)) {
      throw new ConflictException('Esta imagen todavía está referenciada por una Plantilla o versión y no puede eliminarse.');
    }

    await this.storage.deleteUnreferencedImage(asset.objectKey);
    await this.assets.update(asset.id, { status: 'DELETED', deletedAt: new Date() });

    await this.audit.record({
      organizationId,
      actorId,
      action: 'email_body_asset.delete',
      entityType: 'EmailBodyAsset',
      entityId: asset.id,
      metadata: {},
    });
  }

  private async isReferenced(organizationId: string, ownerUserId: string, objectKey: string): Promise<boolean> {
    const ownedTemplates = await this.templates.findByOwner(organizationId, ownerUserId);
    for (const template of ownedTemplates) {
      const steps = await this.steps.findByTemplate(template.id);
      if (steps.some((step) => step.bodyHtml.includes(objectKey))) return true;

      const versions = await this.templateVersions.findByTemplate(template.id);
      for (const version of versions) {
        if (version.steps.some((step) => step.bodyHtml.includes(objectKey))) return true;
      }
    }
    return false;
  }

  /** Same manual/cron-ready hook as SignatureAssetsService — never automatic. */
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
