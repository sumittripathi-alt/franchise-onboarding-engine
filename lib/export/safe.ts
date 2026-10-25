// Formula-injection protection for exported spreadsheets (G6.4): any text cell that starts with a character
// a spreadsheet treats as a formula is prefixed with an apostrophe, so it is always shown as text.

const DANGEROUS_START = /^[=+\-@\t\r]/;

export function safeCell<T>(value: T): T | string {
  if (typeof value !== "string") return value;
  return DANGEROUS_START.test(value) ? `'${value}` : value;
}

export function safeRow(row: unknown[]): unknown[] {
  return row.map((v) => safeCell(v));
}
