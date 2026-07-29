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
  /** `signatures/{organizationId}/{ownerUserId}/{assetId}.{extension}` — immutable, never reused. */
  objectKey: string;
  publicUrl: string;
}

/**
 * Fase Firma, §2 — the only door between the application layer and
 * wherever signature images physically live. Never touches templates,
 * versions or HTML — the caller (SignatureAssetsService) does the
 * validation/persistence around it. Two adapters implement this:
 * SimulatedSignatureAssetStorageAdapter (dev/test, real local writes) and
 * R2SignatureAssetStorageAdapter (production, Cloudflare R2).
 */
export interface SignatureAssetStoragePort {
  uploadImage(input: UploadSignatureAssetInput): Promise<UploadedSignatureAsset>;
  getPublicUrl(objectKey: string): string;
  /** Physically removes the object — callers must only invoke this once the caller (not this port) has confirmed the asset is unreferenced. */
  deleteUnreferencedImage(objectKey: string): Promise<void>;
  /** True when the object still exists in the backing store — used by the sanitizer/publish path to refuse a signatureHtml that references a since-deleted asset. */
  validateAssetExistence(objectKey: string): Promise<boolean>;
}
