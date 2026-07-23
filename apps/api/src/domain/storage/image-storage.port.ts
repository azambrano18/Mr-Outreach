export interface StoreImageInput {
  organizationId: string;
  buffer: Buffer;
  mimeType: string;
  /** Extension only, already derived from a validated magic-byte sniff — never trusted from the client filename. */
  extension: string;
}

export interface StoredImage {
  /** Publicly fetchable — email clients load signature/step images unauthenticated, like any other hosted asset. */
  url: string;
  key: string;
}

/**
 * Port for signature/step image uploads. LocalImageStorageAdapter (dev,
 * STORAGE_DRIVER=local) and S3ImageStorageAdapter (STORAGE_DRIVER=s3, not
 * configured in this environment — see its class comment) both implement
 * this; the application layer never knows which one is active. Mirrors
 * the PersistenceModule/EngineModule driver-switch pattern.
 */
export interface ImageStoragePort {
  store(input: StoreImageInput): Promise<StoredImage>;
}
