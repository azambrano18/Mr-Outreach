/**
 * Real content sniffing (magic bytes), not the client-supplied filename or
 * declared Content-Type — both are attacker-controlled. Only the formats
 * explicitly allowed for signature/step images (section 7 of the request):
 * PNG, JPG/JPEG, GIF (static or animated, we don't need to tell them
 * apart), WebP.
 */
export interface SniffedImage {
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  extension: 'png' | 'jpg' | 'gif' | 'webp';
}

export function sniffImageType(buffer: Buffer): SniffedImage | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return null;
}
