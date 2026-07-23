import { sniffImageType } from './image-mime-sniffer';

describe('sniffImageType', () => {
  it('recognizes a PNG by magic bytes', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(buffer)).toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('recognizes a JPEG by magic bytes', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(buffer)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
  });

  it('recognizes a GIF by magic bytes', () => {
    const buffer = Buffer.from('GIF89a' + '\0'.repeat(6), 'binary');
    expect(sniffImageType(buffer)).toEqual({ mimeType: 'image/gif', extension: 'gif' });
  });

  it('recognizes a WebP by magic bytes', () => {
    const buffer = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(sniffImageType(buffer)).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('rejects a renamed non-image file (e.g. an HTML file with a .png extension)', () => {
    const buffer = Buffer.from('<html><body>not an image</body></html>');
    expect(sniffImageType(buffer)).toBeNull();
  });

  it('rejects an empty or too-short buffer', () => {
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});
