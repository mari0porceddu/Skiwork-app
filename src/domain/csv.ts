/** Esportazione CSV (separatore ";" per compatibilità con Excel in italiano). */

function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Protezione da formula injection nei fogli di calcolo
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/** Centesimi -> "12,50" per i fogli di calcolo italiani. */
export function csvAmount(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}
