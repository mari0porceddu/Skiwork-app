import { describe, expect, it } from 'vitest';
import { encodeWinAnsi, PdfDoc } from '../src/domain/pdf';
import { buildPeriodReport, periodLabel } from '../src/domain/pdfReport';
import { splitByMonth } from '../src/domain/reports';
import { activity, client, doc, payment } from './fixtures';

const ascii = (b: Uint8Array) => String.fromCharCode(...b);

describe('generatore PDF', () => {
  it('codifica accenti, € e caratteri non disponibili', () => {
    expect(encodeWinAnsi('è€à')).toEqual([0xe8, 0x80, 0xe0]);
    expect(encodeWinAnsi('2 h 30′')).toEqual([...'2 h 30\''].map((c) => c.charCodeAt(0)));
    expect(encodeWinAnsi('漢')).toEqual([0x3f]);
  });

  it('misura il testo con le metriche Helvetica', () => {
    const d = new PdfDoc();
    expect(d.textWidth('a', 10)).toBeCloseTo(5.56);
    expect(d.textWidth('a', 10, true)).toBeCloseTo(5.56);
    expect(d.textWidth('i', 10, true)).toBeCloseTo(2.78);
    expect(d.textWidth(d.fit('Scuola sci Monte Bianco', 40), 10)).toBeLessThanOrEqual(40);
  });

  it('produce un file con tabella xref coerente', () => {
    const d = new PdfDoc();
    d.text(40, 40, 'Ciao');
    d.addPage();
    const s = ascii(d.build('Prova'));
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(s).toContain('/Count 2');
  });
});

describe('report PDF del periodo', () => {
  const data = {
    clients: [client(), client({ id: 'asd', name: 'Sci Club', kind: 'asd' })],
    activities: [
      activity({ id: 'a1', date: '2026-01-10' }),
      activity({ id: 'a2', date: '2026-01-20', clientId: 'asd', type: 'training', status: 'planned' }),
      activity({ id: 'a3', date: '2026-02-05' }),
    ],
    ledger: [],
    documents: [doc()],
    payments: [payment({ date: '2026-01-31' })],
  };

  it('etichetta il periodo', () => {
    expect(periodLabel({ from: '2026-01-01', to: '2026-01-31' })).toBe('gennaio 2026');
    expect(periodLabel({ from: '2026-01-05', to: '2026-02-10' })).toBe('05/01/2026 – 10/02/2026');
    expect(splitByMonth({ from: '2026-01-05', to: '2026-03-10' })).toEqual([
      { from: '2026-01-05', to: '2026-01-31' },
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-03-10' },
    ]);
  });

  it('genera un PDF valido con i totali del periodo', () => {
    const bytes = buildPeriodReport({ period: { from: '2026-01-01', to: '2026-01-31' }, clientId: null, data, today: '2026-02-15' });
    const s = ascii(bytes);
    expect(s.startsWith('%PDF-')).toBe(true);
    const hex = (t: string) => encodeWinAnsi(t).map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(s).toContain(`<${hex('Attività (2)')}>`);
    expect(s).toContain(hex('100,00'));
  });

  it('va a capo su più pagine con molte attività', () => {
    const many = Array.from({ length: 120 }, (_, i) => activity({ id: `m${i}`, date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, title: `Lezione ${i}` }));
    const bytes = buildPeriodReport({ period: { from: '2025-11-01', to: '2026-04-30' }, clientId: null, data: { ...data, activities: many }, today: '2026-05-01' });
    const pages = Number(/\/Count (\d+)/.exec(ascii(bytes))![1]);
    expect(pages).toBeGreaterThan(2);
  });
});
