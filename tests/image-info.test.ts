import { describe, expect, it } from 'vitest';
import { extensionFor, inspectImage, mimeFromBuffer } from '@/lib/image-info';
import { fakeJpeg, fakePng, fakeWebp } from './helpers/fake-images';

describe('inspectImage', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    const info = inspectImage(fakePng(1800, 2400));
    expect(info.format).toBe('png');
    expect(info.width).toBe(1800);
    expect(info.height).toBe(2400);
  });

  it('reads JPEG dimensions from the SOF marker', () => {
    const info = inspectImage(fakeJpeg(3000, 4000));
    expect(info.format).toBe('jpeg');
    expect(info.width).toBe(3000);
    expect(info.height).toBe(4000);
  });

  it('reads WEBP dimensions from the VP8X chunk', () => {
    const info = inspectImage(fakeWebp(1200, 1600));
    expect(info.format).toBe('webp');
    expect(info.width).toBe(1200);
    expect(info.height).toBe(1600);
  });

  it('reports unknown for non-image data instead of throwing', () => {
    const info = inspectImage(Buffer.from('this is not an image at all'));
    expect(info.format).toBe('unknown');
    expect(info.width).toBeNull();
  });
});

describe('mime detection', () => {
  it('maps a PNG header back to image/png', () => {
    expect(mimeFromBuffer(fakePng())).toBe('image/png');
    expect(mimeFromBuffer(fakeJpeg())).toBe('image/jpeg');
    expect(mimeFromBuffer(fakeWebp())).toBe('image/webp');
  });

  it('maps mime types to file extensions', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('application/octet-stream')).toBe('jpg');
  });
});
