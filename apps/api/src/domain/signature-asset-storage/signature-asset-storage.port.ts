export interface UploadSignatureAssetInput {
  /** Fully built and validated by the caller (service layer) — this port never constructs paths itself, and never sees organizationId/ownerUserId/mailboxId directly. */
  objectKey: string;
  buffer: Buffer;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif';
}

export interface UploadedSignatureAsset {
  objectKey: string;
  publicUrl: string;
}

/**
 * §9 — the result of a HeadObject-equivalent existence check. `exists:
 * false` means a genuine "object not found" (404/NoSuchKey) — anything
 * else (access denied, timeout, malformed response) is a thrown
 * SignatureAssetAccessDenied/SignatureAssetStorageUnavailable instead,
 * never silently folded into `exists: false`.
 */
export interface SignatureAssetHeadResult {
  exists: boolean;
  contentType?: string;
  sizeBytes?: number;
  etag?: string;
  lastModified?: string;
}

export interface DeleteObjectsByPrefixResult {
  deletedCount: number;
}

/**
 * Fase Firma, §2 / Fase 2 (R2), §8 — the only door between the application
 * layer and wherever asset images physically live. Never touches
 * templates, versions, mailboxes or HTML — the caller (SignatureAssetsService
 * / EmailBodyAssetsService / DeleteMailboxUseCase) does all validation,
 * persistence and reference-checking around it; this port only knows about
 * bytes and object keys. Two adapters implement it:
 * SimulatedSignatureAssetStorageAdapter (dev/test, real local writes) and
 * R2SignatureAssetStorageAdapter (production, real Cloudflare R2 via
 * PutObject/HeadObject/DeleteObject/ListObjectsV2/DeleteObjects).
 *
 * Despite the name (kept for minimal churn from Fase Firma), this port is
 * shared by BOTH signature images (`firmas/{correo}/...`) and email-body
 * images (`email-body/{organizationId}/{ownerUserId}/...`) since Fase 2 (R2)
 * — it is deliberately ignorant of which kind of asset it's storing.
 */
export interface SignatureAssetStoragePort {
  uploadImage(input: UploadSignatureAssetInput): Promise<UploadedSignatureAsset>;
  getPublicUrl(objectKey: string): string;
  /** Physically removes ONE object — callers must only invoke this once they have confirmed the asset is unreferenced. Idempotent: deleting an already-gone object is not an error. */
  deleteUnreferencedImage(objectKey: string): Promise<void>;
  /** HeadObject-equivalent existence + metadata check — see SignatureAssetHeadResult. */
  validateAssetExistence(objectKey: string): Promise<SignatureAssetHeadResult>;
  /**
   * Fase 2 (R2), §8/§20-21 — bulk, paginated delete of every object under
   * `prefix` (must end with `/`, enforced by callers via
   * buildSignatureFolderPrefix). Used only for whole-account cleanup on
   * mailbox deletion — never for a single asset (use
   * `deleteUnreferencedImage` for that). Idempotent: a prefix with zero
   * remaining objects is a successful no-op, never an error.
   */
  deleteObjectsByPrefix(prefix: string): Promise<DeleteObjectsByPrefixResult>;
}
