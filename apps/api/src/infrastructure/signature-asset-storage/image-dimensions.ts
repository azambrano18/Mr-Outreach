/**
 * Fase Firma, §5 — width/height extraction straight from the validated
 * magic-byte-sniffed buffer, no external dependency. Only the 3 formats
 * signatures allow (PNG/JPEG/GIF) are supported; WebP is deliberately never
 * handled here since it's rejected before this is ever called.
 */
export function getImageDimensions(
  buffer: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif',
): { width: number; height: number } | null {
  if (mimeType === 'image/png') return readPngDimensions(buffer);
  if (mimeType === 'image/gif') return readGifDimensions(buffer);
  return readJpegDimensions(buffer);
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readGifDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 10) return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

/** Scans JPEG markers for the first Start-Of-Frame segment (SOF0/SOF2 — baseline/progressive, the only kinds a mail-client-safe signature image should ever use). */
function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2; // skip the SOI marker (0xFFD8)
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15, excluding DHT(C4)/JPG(C8)/DAC(CC) which share the range but aren't frame headers.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}
