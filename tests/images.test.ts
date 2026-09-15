import { describe, expect, it } from 'vitest';
import {
  buildSlotChecklist,
  canonicalFileName,
  formatBytes,
  photographyProgress,
  validateImageBuffer,
  DEFAULT_IMAGE_RULES,
} from '@/lib/images';
import { fakeJpeg, fakePng } from './helpers/fake-images';

function paddedImage(header: Buffer, totalBytes: number): Buffer {
  if (header.length >= totalBytes) return header;
  return Buffer.concat([header, Buffer.alloc(totalBytes - header.length, 0x7f)]);
}

describe('canonicalFileName (spec §20)', () => {
  it('produces SKU-SLOT filenames', () => {
    expect(
      canonicalFileName({ sku: 'HOKK-SAR-ZK-001', slotSuffix: 'HERO', mimeType: 'image/jpeg' }),
    ).toBe('HOKK-SAR-ZK-001-HERO.jpg');
    expect(
      canonicalFileName({ sku: 'HOKK-SAR-ZK-001', slotSuffix: 'PALLU', mimeType: 'image/png' }),
    ).toBe('HOKK-SAR-ZK-001-PALLU.png');
  });

  it('uppercases the SKU and strips invalid characters', () => {
    expect(
      canonicalFileName({ sku: 'hokk sar zk 001', slotSuffix: 'border', mimeType: 'image/webp' }),
    ).toBe('HOKK-SAR-ZK-001-BORDER.webp');
  });

  it('falls back to a sanitised original name when no slot is chosen', () => {
    const name = canonicalFileName({
      sku: 'HOKK-APP-TS-001',
      mimeType: 'image/jpeg',
      originalName: 'shoot_014 final.jpg',
      index: 3,
    });
    expect(name).toBe('HOKK-APP-TS-001-SHOOT-014-FINAL-03.jpg');
  });
});

describe('validateImageBuffer (spec §21)', () => {
  it('accepts a well-formed, correctly-sized JPEG', () => {
    const issues = validateImageBuffer(paddedImage(fakeJpeg(2400, 3000), 3 * 1024 * 1024), {
      mimeType: 'image/jpeg',
      originalName: 'hero.jpg',
    });
    expect(issues).toEqual([]);
  });

  it('rejects a disallowed format', () => {
    const issues = validateImageBuffer(paddedImage(fakeJpeg(), 1024 * 1024), {
      mimeType: 'image/gif',
      originalName: 'hero.gif',
    });
    expect(issues.some((i) => i.code === 'TYPE_NOT_ALLOWED' && i.severity === 'ERROR')).toBe(true);
  });

  it('flags files that are too small as a warning', () => {
    const issues = validateImageBuffer(paddedImage(fakeJpeg(), 5 * 1024), {
      mimeType: 'image/jpeg',
      originalName: 'thumb.jpg',
    });
    expect(issues.some((i) => i.code === 'TOO_SMALL' && i.severity === 'WARNING')).toBe(true);
  });

  it('rejects files over the maximum size', () => {
    const issues = validateImageBuffer(paddedImage(fakeJpeg(), DEFAULT_IMAGE_RULES.maxBytes + 1024), {
      mimeType: 'image/jpeg',
      originalName: 'huge.jpg',
    });
    expect(issues.some((i) => i.code === 'TOO_LARGE' && i.severity === 'ERROR')).toBe(true);
  });

  it('warns when the resolution is below the recommendation', () => {
    const issues = validateImageBuffer(paddedImage(fakePng(800, 800), 1024 * 1024), {
      mimeType: 'image/png',
      originalName: 'small.png',
    });
    expect(issues.map((i) => i.code)).toContain('WIDTH_TOO_SMALL');
    expect(issues.map((i) => i.code)).toContain('HEIGHT_TOO_SMALL');
  });

  it('rejects data that is not an image at all', () => {
    const issues = validateImageBuffer(Buffer.concat([Buffer.from('not-an-image'), Buffer.alloc(100 * 1024, 1)]), {
      mimeType: 'image/jpeg',
      originalName: 'notes.jpg',
    });
    expect(issues.some((i) => i.code === 'UNREADABLE')).toBe(true);
  });
});

describe('photography checklist (spec §17)', () => {
  const slots = [
    { id: 's1', key: 'HERO', label: 'Hero', file_suffix: 'HERO', is_required: 1 },
    { id: 's2', key: 'FULL', label: 'Full look', file_suffix: 'FULL', is_required: 1 },
    { id: 's3', key: 'DETAIL', label: 'Detail', file_suffix: 'DETAIL', is_required: 1 },
    { id: 's4', key: 'PALLU', label: 'Pallu', file_suffix: 'PALLU', is_required: 1 },
    { id: 's5', key: 'BORDER', label: 'Border', file_suffix: 'BORDER', is_required: 1 },
    { id: 's6', key: 'FABRIC', label: 'Fabric', file_suffix: 'FABRIC', is_required: 1 },
    { id: 's7', key: 'BLOUSE', label: 'Blouse', file_suffix: 'BLOUSE', is_required: 0 },
  ];

  it('counts filled required slots against the total', () => {
    const images = [{ slot_id: 's1' }, { slot_id: 's2' }, { slot_id: 's3' }, { slot_id: 's4' }];
    const checklist = buildSlotChecklist(slots, images);
    const progress = photographyProgress(checklist);
    expect(progress).toEqual({ complete: 4, required: 6, pct: 67 });
    const missing = checklist.filter((s) => s.state === 'MISSING').map((s) => s.slotKey);
    expect(missing).toEqual(['BORDER', 'FABRIC', 'BLOUSE']);
  });

  it('does not count optional slots towards required completeness', () => {
    const images = [{ slot_id: 's7' }];
    const progress = photographyProgress(buildSlotChecklist(slots, images));
    expect(progress.complete).toBe(0);
    expect(progress.required).toBe(6);
  });
});

describe('formatBytes', () => {
  it('renders human sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
