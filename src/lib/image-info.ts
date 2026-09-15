/**
 * Dependency-free image header inspection.
 *
 * We only need width/height/format for validation, so we parse the file header
 * instead of pulling in a native imaging library. Supports PNG, JPEG, WEBP and
 * GIF — the formats the catalog accepts.
 */

export interface ImageInfo {
  width: number | null;
  height: number | null;
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'unknown';
}

function readUInt16BE(buf: Buffer, offset: number): number {
  return buf.readUInt16BE(offset);
}

function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 10) return null;
  const head = buf.subarray(0, 3).toString('ascii');
  if (head !== 'GIF') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // Standalone markers with no payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = readUInt16BE(buf, offset + 2);
    if (segmentLength < 2) return null;
    // SOF0..SOF15 excluding DHT(C4), JPG(C8), DAC(CC)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 >= buf.length) return null;
      return {
        height: readUInt16BE(buf, offset + 5),
        width: readUInt16BE(buf, offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') return null;
  if (buf.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const fourcc = buf.subarray(12, 16).toString('ascii');
  if (fourcc === 'VP8 ') {
    // Lossy: frame tag starts at 20; width/height are 14-bit LE at 26/28.
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (fourcc === 'VP8X') {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  return null;
}

export function inspectImage(buf: Buffer): ImageInfo {
  const png = pngSize(buf);
  if (png) return { ...png, format: 'png' };
  const gif = gifSize(buf);
  if (gif) return { ...gif, format: 'gif' };
  const webp = webpSize(buf);
  if (webp) return { ...webp, format: 'webp' };
  const jpeg = jpegSize(buf);
  if (jpeg) return { ...jpeg, format: 'jpeg' };
  return { width: null, height: null, format: 'unknown' };
}

export function extensionFor(mimeType: string, fallback = 'jpg'): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[mimeType.toLowerCase()] ?? fallback;
}

export function mimeFromBuffer(buf: Buffer): string {
  const info = inspectImage(buf);
  switch (info.format) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}
