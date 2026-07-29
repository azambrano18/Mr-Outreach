import { getImageDimensions } from './image-dimensions';

function pngWithSize(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13, 0);
  const chunkType = Buffer.from('IHDR', 'ascii');
  const widthBuf = Buffer.alloc(4);
  widthBuf.writeUInt32BE(width, 0);
  const heightBuf = Buffer.alloc(4);
  heightBuf.writeUInt32BE(height, 0);
  return Buffer.concat([signature, length, chunkType, widthBuf, heightBuf, Buffer.alloc(8)]);
}

function gifWithSize(width: number, height: number): Buffer {
  const header = Buffer.from('GIF89a', 'ascii');
  const widthBuf = Buffer.alloc(2);
  widthBuf.writeUInt16LE(width, 0);
  const heightBuf = Buffer.alloc(2);
  heightBuf.writeUInt16LE(height, 0);
  return Buffer.concat([header, widthBuf, heightBuf, Buffer.alloc(4)]);
}

function jpegWithSize(width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const sofMarker = Buffer.from([0xff, 0xc0]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(17, 0);
  const precision = Buffer.from([0x08]);
  const heightBuf = Buffer.alloc(2);
  heightBuf.writeUInt16BE(height, 0);
  const widthBuf = Buffer.alloc(2);
  widthBuf.writeUInt16BE(width, 0);
  return Buffer.concat([soi, sofMarker, length, precision, heightBuf, widthBuf, Buffer.alloc(10)]);
}

describe('getImageDimensions — Fase Firma, §5', () => {
  it('reads PNG width/height from the IHDR chunk', () => {
    expect(getImageDimensions(pngWithSize(600, 200), 'image/png')).toEqual({ width: 600, height: 200 });
  });

  it('reads GIF width/height from the logical screen descriptor', () => {
    expect(getImageDimensions(gifWithSize(400, 150), 'image/gif')).toEqual({ width: 400, height: 150 });
  });

  it('reads JPEG width/height from the SOF0 marker', () => {
    expect(getImageDimensions(jpegWithSize(1000, 300), 'image/jpeg')).toEqual({ width: 1000, height: 300 });
  });

  it('returns null for a truncated PNG buffer', () => {
    expect(getImageDimensions(Buffer.from([0x89, 0x50]), 'image/png')).toBeNull();
  });

  it('returns null for a JPEG with no SOF marker at all', () => {
    expect(getImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
  });
});
