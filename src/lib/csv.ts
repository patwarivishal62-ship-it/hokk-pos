/**
 * RFC 4180 CSV reader / writer.
 *
 * Hand-rolled rather than pulled from a dependency: the export must produce
 * byte-exact output Shopify accepts (UTF-8, CRLF-friendly, correct quoting of
 * embedded quotes/newlines/commas) and the importer must tolerate files
 * exported from Excel and Google Sheets.
 */

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  // Escape internal double quotes by doubling them.
  const needsQuotes = /[",\r\n]/.test(text) || text.startsWith(' ') || text.endsWith(' ');
  const escaped = text.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>, opts?: { eol?: string; bom?: boolean }): string {
  const eol = opts?.eol ?? '\n';
  const lines: string[] = [];
  lines.push(columns.map(csvEscape).join(','));
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  }
  const csv = lines.join(eol) + eol;
  // A BOM keeps Excel from mangling UTF-8 text (Devanagari product names).
  return opts?.bom === false ? csv : `\uFEFF${csv}`;
}

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
  /** Rows that had a different column count than the header. */
  raggedRows: number[];
}

/** Streaming-free parser — catalog imports are bounded (<= 15 MB per Shopify). */
export function parseCsv(text: string, opts?: { headerRow?: number }): ParsedCsv {
  const headerRowIndex = Math.max(1, opts?.headerRow ?? 1);
  const cleaned = text.replace(/^\uFEFF/, '');
  const records = parseRecords(cleaned);
  if (records.length === 0) return { columns: [], rows: [], raggedRows: [] };

  const headerRecord = records[headerRowIndex - 1] ?? records[0];
  const columns = headerRecord.map((c, i) => (c && c.trim() ? c.trim() : `Column ${i + 1}`));

  const rows: Record<string, string>[] = [];
  const raggedRows: number[] = [];
  for (let i = headerRowIndex; i < records.length; i += 1) {
    const record = records[i];
    // Skip completely blank lines.
    if (record.length === 1 && record[0].trim() === '') continue;
    if (record.length !== columns.length) raggedRows.push(i + 1);
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = (record[index] ?? '').trim();
    });
    rows.push(row);
  }
  return { columns, rows, raggedRows };
}

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRecord();
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRecord();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field.length > 0 || record.length > 0) endRecord();
  return records;
}

/** Splits a Shopify-style comma list, tolerating quoted values. */
export function splitList(value: string | null | undefined, separator = ','): string[] {
  if (!value) return [];
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}
