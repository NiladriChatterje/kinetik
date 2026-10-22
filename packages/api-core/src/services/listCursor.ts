// Opaque keyset cursors for paged lists.
//
// A cursor carries the sort-key values of the last row of a page, so the next
// page is "the rows after these values" however the rows themselves move
// meanwhile: a row that moves above the cursor is not shown again, and one
// that moves below it is still reached. A cursor built from a row id would
// instead follow that row wherever it went and repeat or skip a page.
//
// Timestamps travel as the text cursorTimestampSql() produces, which keeps
// Postgres's microseconds (a JS Date would not) and casts back exactly with
// ::timestamptz.

const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}\+00$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQL giving a timestamptz expression in the text form a cursor carries. */
export function cursorTimestampSql(expression: string): string {
  return `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US"+00"')`;
}

export function encodeCursor(parts: string[]): string {
  return Buffer.from(parts.join('|'), 'utf8').toString('base64url');
}

/**
 * The parts of a cursor, checked one by one against the shape the list
 * expects, or null for anything this list did not produce.
 */
export function decodeCursor(
  cursor: string,
  shape: ('timestamp' | 'uuid' | 'flag')[],
): string[] | null {
  const parts = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (parts.length !== shape.length) return null;
  const valid = parts.every((part, i) =>
    shape[i] === 'timestamp'
      ? TIMESTAMP_TEXT.test(part)
      : shape[i] === 'uuid'
        ? UUID.test(part)
        : part === '0' || part === '1',
  );
  return valid ? parts : null;
}

/** Page size from a query string: the default when absent, kept within [1, max]. */
export function pageLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, n));
}
