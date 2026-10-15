/**
 * Generatore PDF minimo, senza dipendenze: testo con i font standard Helvetica e Helvetica-Bold
 * (codifica WinAnsi, che copre lettere accentate italiane e €), linee e rettangoli.
 * Coordinate in punti con origine in alto a sinistra; pagina A4 verticale.
 */

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

// Larghezze dei glifi (millesimi di em) per i codici WinAnsi 32-255, dalle metriche AFM standard.
const WIDTHS_REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const WIDTHS_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];

// Caratteri Unicode fuori da Latin-1 presenti in WinAnsi (0x80-0x9F).
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// Sostituzioni per caratteri comuni non disponibili nei font standard.
const FALLBACK: Record<number, string> = { 0x2032: "'", 0x2033: '"', 0x2192: '->', 0x2190: '<-', 0x202f: ' ', 0x2009: ' ', 0x2212: '-', 0x2010: '-', 0x2011: '-' };

/** Converte una stringa nei byte WinAnsi; i caratteri non rappresentabili diventano "?". */
export function encodeWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) out.push(0x20);
    else if ((cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else if (CP1252_HIGH[cp] !== undefined) out.push(CP1252_HIGH[cp]!);
    else if (FALLBACK[cp] !== undefined) out.push(...encodeWinAnsi(FALLBACK[cp]!));
    else out.push(0x3f);
  }
  return out;
}

export interface TextOptions {
  size?: number;
  bold?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Colore RGB 0-1. */
  color?: [number, number, number];
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const rgb = (c: [number, number, number]) => c.map(n).join(' ');

export class PdfDoc {
  private pages: string[][] = [];
  private current: string[] = [];

  constructor() {
    this.addPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(): void {
    this.current = [];
    this.pages.push(this.current);
  }

  /** Passa a una pagina già creata (es. per scrivere i numeri di pagina alla fine). */
  setPage(index: number): void {
    this.current = this.pages[index]!;
  }

  textWidth(text: string, size = 10, bold = false): number {
    const w = bold ? WIDTHS_BOLD : WIDTHS_REGULAR;
    let total = 0;
    for (const b of encodeWinAnsi(text)) total += w[b - 32] ?? 0;
    return (total * size) / 1000;
  }

  /** Accorcia il testo con "…" finché non rientra nella larghezza indicata. */
  fit(text: string, maxWidth: number, size = 10, bold = false): string {
    if (this.textWidth(text, size, bold) <= maxWidth) return text;
    const chars = [...text];
    while (chars.length > 0 && this.textWidth(chars.join('') + '…', size, bold) > maxWidth) chars.pop();
    return chars.length > 0 ? chars.join('').trimEnd() + '…' : '';
  }

  /** Divide il testo in righe che rientrano nella larghezza indicata. */
  wrap(text: string, maxWidth: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.textWidth(candidate, size, bold) <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.map((l) => this.fit(l, maxWidth, size, bold));
  }

  /** y è la linea di base del testo. */
  text(x: number, y: number, text: string, o: TextOptions = {}): void {
    const size = o.size ?? 10;
    const bold = o.bold ?? false;
    const w = this.textWidth(text, size, bold);
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    const hex = encodeWinAnsi(text)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    this.current.push(`BT ${rgb(o.color ?? [0, 0, 0])} rg /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(left)} ${n(PAGE_HEIGHT - y)} Td <${hex}> Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, color: [number, number, number] = [0.8, 0.8, 0.8]): void {
    this.current.push(`${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(PAGE_HEIGHT - y1)} m ${n(x2)} ${n(PAGE_HEIGHT - y2)} l S`);
  }

  rect(x: number, y: number, w: number, h: number, fill: [number, number, number]): void {
    this.current.push(`${rgb(fill)} rg ${n(x)} ${n(PAGE_HEIGHT - y - h)} ${n(w)} ${n(h)} re f`);
  }

  /** Serializza il documento. Tutto il contenuto è ASCII, quindi lunghezza stringa = byte. */
  build(title = ''): Uint8Array {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body);
    add('<< /Type /Catalog /Pages 2 0 R >>');
    const kids = this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
    add(`<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    for (let i = 0; i < this.pages.length; i++) {
      const stream = this.pages[i]!.join('\n');
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_WIDTH)} ${n(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
      add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    }
    add(`<< /Title ${utf16Hex(title)} /Producer (SkiWork) >>`);
    const infoRef = objects.length;

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
    return bytes;
  }
}

/** Stringa PDF in UTF-16BE (per i metadati, che possono contenere qualsiasi carattere). */
function utf16Hex(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex}>`;
}
