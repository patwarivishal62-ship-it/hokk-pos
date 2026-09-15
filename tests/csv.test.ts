import { describe, expect, it } from 'vitest';
import { csvEscape, parseCsv, splitList, toCsv } from '@/lib/csv';

describe('csv escaping', () => {
  it('quotes values containing commas, quotes or newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('has, comma')).toBe('"has, comma"');
    expect(csvEscape('has "quotes"')).toBe('"has ""quotes"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });

  it('renders null and undefined as empty strings', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(0)).toBe('0');
  });

  it('adds a UTF-8 BOM by default so Excel keeps Devanagari intact', () => {
    const csv = toCsv(['Title'], [{ Title: 'कला' }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('कला');
  });

  it('can omit the BOM for Shopify imports', () => {
    const csv = toCsv(['Title'], [{ Title: 'Amara' }], { bom: false });
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.startsWith('Title')).toBe(true);
  });
});

describe('csv parsing', () => {
  it('round-trips quoted fields with embedded commas and newlines', () => {
    const columns = ['Title', 'Body (HTML)'];
    const rows = [
      { Title: 'Amara, Zari Kota', 'Body (HTML)': '<p>Line one\nLine two</p>' },
      { Title: 'He said "handloom"', 'Body (HTML)': '' },
    ];
    const csv = toCsv(columns, rows, { bom: false });
    const parsed = parseCsv(csv);
    expect(parsed.columns).toEqual(columns);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]['Title']).toBe('Amara, Zari Kota');
    expect(parsed.rows[0]['Body (HTML)']).toBe('<p>Line one\nLine two</p>');
    expect(parsed.rows[1]['Title']).toBe('He said "handloom"');
  });

  it('handles CRLF line endings from Excel exports', () => {
    const parsed = parseCsv('Handle,Title\r\namara,Amara\r\nbala,Bala\r\n');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]['Title']).toBe('Bala');
  });

  it('reports ragged rows instead of silently misaligning columns', () => {
    const parsed = parseCsv('A,B,C\n1,2,3\n4,5\n');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.raggedRows).toEqual([3]);
  });

  it('skips blank lines', () => {
    const parsed = parseCsv('A,B\n1,2\n\n3,4\n');
    expect(parsed.rows).toHaveLength(2);
  });

  it('supports a header row other than the first', () => {
    const parsed = parseCsv('Legacy catalog export\nA,B\n1,2\n', { headerRow: 2 });
    expect(parsed.columns).toEqual(['A', 'B']);
    expect(parsed.rows[0]).toEqual({ A: '1', B: '2' });
  });
});

describe('splitList', () => {
  it('trims and drops empties', () => {
    expect(splitList('a, b ,, c')).toEqual(['a', 'b', 'c']);
    expect(splitList(null)).toEqual([]);
  });
});
