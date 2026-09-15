/** Synthetic image headers used to exercise the header parser without binary fixtures. */

function uint32be(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

export function fakePng(width = 2400, height = 3000): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    uint32be(13),
    Buffer.from('IHDR'),
    uint32be(width),
    uint32be(height),
    Buffer.from([8, 2, 0, 0, 0]),
    uint32be(0),
  ]);
}

export function fakeJpeg(width = 2400, height = 3000): Buffer {
  const buf = Buffer.alloc(30);
  buf[0] = 0xff; buf[1] = 0xd8;
  buf[2] = 0xff; buf[3] = 0xe0;
  buf.writeUInt16BE(16, 4);
  buf[20] = 0xff; buf[21] = 0xc0;
  buf.writeUInt16BE(17, 22);
  buf[24] = 0x08;
  buf.writeUInt16BE(height, 25);
  buf.writeUInt16BE(width, 27);
  return buf;
}

export function fakeWebp(width = 1600, height = 2000): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf[24] = (width - 1) & 0xff;
  buf[25] = ((width - 1) >> 8) & 0xff;
  buf[26] = ((width - 1) >> 16) & 0xff;
  buf[27] = (height - 1) & 0xff;
  buf[28] = ((height - 1) >> 8) & 0xff;
  buf[29] = ((height - 1) >> 16) & 0xff;
  return buf;
}

