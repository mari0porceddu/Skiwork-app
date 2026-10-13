/**
 * Importi monetari: sempre interi in centesimi di euro.
 * Nessun calcolo economico usa numeri in virgola mobile come valore memorizzato.
 */

export type Cents = number;

/** Arrotondamento "half away from zero" di un numero al centesimo intero. */
export function roundHalfAwayFromZero(value: number): number {
  // Correzione per errori di rappresentazione (es. 1.005 * 100).
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return sign * Math.round(abs + Number.EPSILON * abs);
}

/** Applica una percentuale espressa in punti base (1% = 100 bps) a un importo. */
export function applyBps(amount: Cents, bps: number): Cents {
  if (!Number.isInteger(amount)) throw new Error('Importo non intero in centesimi');
  return roundHalfAwayFromZero((amount * bps) / 10_000);
}

/** Converte "12,50" o "12.50" o "1.234,56" in centesimi. Restituisce null se non valido. */
export function parseEuroToCents(input: string): Cents | null {
  const s = input.trim().replace(/\s|€/g, '');
  if (s === '') return null;
  let normalized = s;
  if (s.includes(',')) {
    // formato italiano: punto come separatore delle migliaia, virgola decimale
    normalized = s.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const [intPart, decPart = ''] = normalized.replace('-', '').split('.');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** Converte centesimi in stringa modificabile, es. 1250 -> "12,50". */
export function centsToInput(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${s}` : s;
}

const formatter = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

export function formatEuro(cents: Cents): string {
  return formatter.format(cents / 100);
}

/** Percentuale in punti base -> stringa "12,5%" */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`;
}

/** "12,5" -> 1250 bps */
export function parsePercentToBps(input: string): number | null {
  const s = input.trim().replace('%', '').replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
