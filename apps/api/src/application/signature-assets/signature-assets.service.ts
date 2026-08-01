import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MailboxAssignmentRepository } from '../../domain/mailbox-assignment/mailbox-assignment.repository';
import { SequenceTemplateVersionRepository } from '../../domain/sequence-template/sequence-template-version.repository';
import { SequenceTemplateRepository } from '../../domain/sequence-template/sequence-template.repository';
import { buildSignatureFolderPrefix, normalizeMailboxEmailForStorageKey } from '../../domain/signature-asset/normalize-mailbox-email-for-storage';
import { SignatureAssetRepository } from '../../domain/signature-asset/signature-asset.repository';
import { SignatureAssetStoragePort } from '../../domain/signature-asset-storage/signature-asset-storage.port';
import { SignatureAssetNotFound, SignatureAssetStillReferenced } from '../../domain/signature-asset-storage/signature-asset-storage.errors';
import { SignatureVersionRepository } from '../../domain/signature/signature-version.repository';
import { SignatureRepository } from '../../domain/signature/signature.repository';
import {
  AUDIT_LOG_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_REPOSITORY,
  SEQUENCE_TEMPLATE_REPOSITORY,
  SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
  SIGNATURE_ASSET_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
} from '../../infrastructure/persistence/tokens';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
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
 * §4-6, §9 — validates a signature image upload (real magic bytes, never
 * the declared Content-Type/extension; format/size/dimension limits) then
 * delegates the actual write to whichever SignatureAssetStoragePort adapter
 * is active, and records an ownership/traceability row. The object key is
 * always `firmas/{correo-normalizado-de-la-cuenta}/{assetId}.{ext}` — a
 * signature image belongs to the mailbox, never to a template or an
 * executive, since Fase 2 (R2) a mailbox has exactly one signature shared
 * by every one of its Plantillas (see SignaturesService).
 */
@Injectable()
export class SignatureAssetsService {
  constructor(
    @Inject(SIGNATURE_ASSET_REPOSITORY) private readonly assets: SignatureAssetRepository,
    @Inject(SIGNATURE_ASSET_STORAGE_PORT) private readonly storage: SignatureAssetStoragePort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly audit: AuditLogRepository,
    @Inject(SEQUENCE_TEMPLATE_REPOSITORY) private readonly templates: SequenceTemplateRepository,
    @Inject(SEQUENCE_TEMPLATE_VERSION_REPOSITORY) private readonly templateVersions: SequenceTemplateVersionRepository,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
    @Inject(MAILBOX_ASSIGNMENT_REPOSITORY) private readonly assignments: MailboxAssignmentRepository,
    @Inject(SIGNATURE_REPOSITORY) private readonly signatures: SignatureRepository,
    @Inject(SIGNATURE_VERSION_REPOSITORY) private readonly signatureVersions: SignatureVersionRepository,
    private readonly config: AppConfigService,
  ) {}

  /** Admin path — permission-only, no assignment check (mirrors SignaturesController vs MeSignatureController). */
  async upload(
    organizationId: string,
    actorId: string,
    mailboxId: string,
    file: UploadSignatureAssetFile,
  ): Promise<SignatureAssetSummary> {
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    return this.performUpload(organizationId, actorId, mailbox, file);
  }

  /** Executive self-service path — same 404-not-403 assignment check as SignaturesService.requireAssignedMailbox. */
  async uploadForExecutive(
    organizationId: string,
    userId: string,
    mailboxId: string,
    file: UploadSignatureAssetFile,
  ): Promise<SignatureAssetSummary> {
    await this.requireAssignedMailbox(userId, mailboxId);
    const mailbox = await this.getOwnedMailbox(organizationId, mailboxId);
    return this.performUpload(organizationId, userId, mailbox, file);
  }

  private async performUpload(
    organizationId: string,
    actorId: string,
    mailbox: Mailbox,
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
      throw new BadRequestException('El contenido del archivo no corresponde a una imagen PNG, JPG o GIF válida.');
    }

    const dimensions = getImageDimensions(file.buffer, sniffed.mimeType);
    if (!dimensions) {
      throw new BadRequestException('No se pudo determinar el tamaño de la imagen.');
    }
    if (dimensions.width > MAX_WIDTH || dimensions.height > MAX_HEIGHT) {
      throw new BadRequestException(
        `La imagen de firma no puede superar ${MAX_WIDTH}x${MAX_HEIGHT} píxeles.`,
      );
    }

    const normalizedEmail = normalizeMailboxEmailForStorageKey(mailbox.email);
    const assetId = randomUUID();
    const objectKey = `${buildSignatureFolderPrefix(this.config.r2SignaturePrefix, normalizedEmail)}${assetId}.${sniffed.extension}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const uploaded = await this.storage.uploadImage({
      objectKey,
      buffer: file.buffer,
      contentType: sniffed.mimeType,
    });

    const asset = await this.assets.create({
      id: assetId,
      organizationId,
      ownerUserId: actorId,
      mailboxId: mailbox.id,
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
      actorId,
      action: 'signature_asset.upload',
      entityType: 'SignatureAsset',
      entityId: asset.id,
      // Never the binary content, never the storage credentials — only the outcome.
      metadata: { mailboxId: mailbox.id, contentType: asset.contentType, sizeBytes: asset.sizeBytes, width: asset.width, height: asset.height },
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
   * §10 — the full orchestration: load, validate ownership/tenant, check
   * every reference (every version ever created for the mailbox's
   * Signature — §16, a replaced image is never deleted while the account
   * exists — plus every already-published SequenceTemplateVersion's frozen
   * signatureHtml snapshot, which transitively covers every Gestión, since
   * a Gestión only ever points at an already-frozen version), reject if
   * referenced, only then delete the physical object and mark the local
   * row DELETED. Idempotent for an already-DELETED row.
   */
  async deleteUnreferencedImage(organizationId: string, actorId: string, assetId: string): Promise<void> {
    const asset = await this.assets.findById(assetId);
    if (!asset || asset.organizationId !== organizationId) {
      throw new SignatureAssetNotFound();
    }
    if (asset.status === 'DELETED') {
      return;
    }

    const referenced = asset.mailboxId
      ? await this.isReferencedByMailbox(organizationId, asset.mailboxId, asset.objectKey)
      : await this.isReferencedByLegacyOwner(organizationId, asset.ownerUserId, asset.objectKey);
    if (referenced) {
      throw new SignatureAssetStillReferenced();
    }

    await this.storage.deleteUnreferencedImage(asset.objectKey);
    await this.assets.update(asset.id, { status: 'DELETED', deletedAt: new Date() });

    await this.audit.record({
      organizationId,
      actorId,
      action: 'signature_asset.delete',
      entityType: 'SignatureAsset',
      entityId: asset.id,
      metadata: {},
    });
  }

  /** Fase 2 (R2) — the authoritative check: every SignatureVersion ever created for this mailbox, plus every published SequenceTemplateVersion's frozen snapshot (historical content). */
  private async isReferencedByMailbox(organizationId: string, mailboxId: string, objectKey: string): Promise<boolean> {
    const signature = await this.signatures.findByMailbox(mailboxId);
    if (signature) {
      const versions = await this.signatureVersions.findBySignature(signature.id);
      if (versions.some((version) => version.htmlContent.includes(objectKey))) return true;
    }

    const templates = await this.templates.findByMailbox(organizationId, mailboxId);
    for (const template of templates) {
      const templateVersions = await this.templateVersions.findByTemplate(template.id);
      if (templateVersions.some((version) => version.signatureHtml.includes(objectKey))) return true;
    }
    return false;
  }

  /** Pre-Fase-2 rows (mailboxId null) — same legacy check this service used before, kept only so an old asset can still be evaluated correctly. */
  private async isReferencedByLegacyOwner(organizationId: string, ownerUserId: string, objectKey: string): Promise<boolean> {
    const ownedTemplates = await this.templates.findByOwner(organizationId, ownerUserId);
    for (const template of ownedTemplates) {
      if (template.signatureHtml.includes(objectKey)) return true;
      const versions = await this.templateVersions.findByTemplate(template.id);
      if (versions.some((version) => version.signatureHtml.includes(objectKey))) return true;
    }
    return false;
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

  /** Same 404-not-403 rule as MailboxesService's own assignment check. */
  private async requireAssignedMailbox(userId: string, mailboxId: string): Promise<void> {
    const userAssignments = await this.assignments.findByUser(userId);
    if (!userAssignments.some((assignment) => assignment.mailboxId === mailboxId)) {
      throw new NotFoundException('Mailbox not found.');
    }
  }

  private async getOwnedMailbox(organizationId: string, mailboxId: string): Promise<Mailbox> {
    const mailbox = await this.mailboxes.findById(mailboxId);
    if (!mailbox || mailbox.organizationId !== organizationId) {
      throw new NotFoundException('Mailbox not found.');
    }
    return mailbox;
  }
}

/** Keeps only a safe base name for display — never a path, never a directory traversal. */
function sanitizeFileName(rawName: string): string {
  const base = rawName.split(/[/\\]/).pop() ?? 'imagen';
  return base.replace(/[^\w.\-\s]/g, '').slice(0, 120) || 'imagen';
}
