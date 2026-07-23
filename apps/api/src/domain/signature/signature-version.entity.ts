/**
 * Immutable history entry — created on every signatures.create/update call,
 * never edited or deleted afterwards. `activateVersion` only moves
 * Signature.activeVersionId to point at an existing one.
 *
 * Fase 9: content moved from a single plain-text field to a rich HTML
 * body (sanitized server-side, see infrastructure/security/html-sanitizer)
 * plus a plain-text counterpart kept for `multipart/alternative` sends and
 * for clients that don't render HTML.
 */
export interface SignatureVersion {
  id: string;
  signatureId: string;
  versionNumber: number;
  htmlContent: string;
  plainTextContent: string;
  createdAt: Date;
  createdBy: string;
}

export interface CreateSignatureVersionInput {
  signatureId: string;
  htmlContent: string;
  plainTextContent: string;
  createdBy: string;
}
