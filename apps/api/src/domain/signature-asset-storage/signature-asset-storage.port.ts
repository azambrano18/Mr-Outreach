export interface UploadSignatureAssetInput {
  organizationId: string;
  ownerUserId: string;
  assetId: string;
  buffer: Buffer;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif';
  /** png | jpg | gif — already derived from a validated magic-byte sniff, never trusted from the client filename. */
  extension: string;
}

export interface UploadedSignatureAsset {
  /** `{prefix}/{organizationId}/{ownerUserId}/{assetId}.{extension}` — immutable, never reused. */
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

/**
 * Fase Firma, §2 — the only door between the application layer and
 * wherever signature images physically live. Never touches templates,
 * versions or HTML — the caller (SignatureAssetsService) does the
 * validation/persistence around it. Two adapters implement this:
 * SimulatedSignatureAssetStorageAdapter (dev/test, real local writes) and
 * R2SignatureAssetStorageAdapter (production, real Cloudflare R2 via
 * PutObject/HeadObject/DeleteObject).
 */
export interface SignatureAssetStoragePort {
  uploadImage(input: UploadSignatureAssetInput): Promise<UploadedSignatureAsset>;
  getPublicUrl(objectKey: string): string;
  /** Physically removes the object — callers must only invoke this once the caller (not this port) has confirmed the asset is unreferenced. Idempotent: deleting an already-gone object is not an error. */
  deleteUnreferencedImage(objectKey: string): Promise<void>;
  /** HeadObject-equivalent existence + metadata check — see SignatureAssetHeadResult. */
  validateAssetExistence(objectKey: string): Promise<SignatureAssetHeadResult>;
}
