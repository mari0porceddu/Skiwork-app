/**
 * Report PDF di un periodo (mese, stagione o intervallo libero): riepilogo, andamento mensile,
 * dettaglio per committente, attività, voci economiche, documenti e incassi.
 * Tutti i valori sono ricalcolati con le stesse funzioni della pagina Finanze.
 */
import { computeActivity } from './compensation';
import { documentStatus } from './documents';
import { formatEuro } from './money';
import { PAGE_HEIGHT, PAGE_WIDTH, PdfDoc } from './pdf';
import { splitByMonth, summarize, type Period, type Summary } from './reports';
import { endOfMonth, formatDateShort, formatMinutesAsHours, monthName, startOfMonth, type ISODate } from './time';
import { ACTIVITY_STATUS_LABEL, ACTIVITY_TYPE_LABEL, DOCUMENT_STATUS_LABEL, LEDGER_KIND_LABEL, isWorkType } from './types';
import type { Activity, Client, LedgerEntry, Payment, WorkDocument } from './types';

export interface ReportInput {
  period: Period;
  clientId: string | null;
  data: { clients: Client[]; activities: Activity[]; ledger: LedgerEntry[]; documents: WorkDocument[]; payments: Payment[] };
  /** Data di generazione (oggi), usata anche per lo stato dei documenti. */
  today: ISODate;
}

type RGB = [number, number, number];
const MARGIN = 40;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = PAGE_HEIGHT - 50;
const ACCENT: RGB = [0.11, 0.37, 0.63];
const MUTED: RGB = [0.42, 0.45, 0.5];
const BAND: RGB = [0.94, 0.96, 0.98];

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

/** "ottobre 2026" se il periodo è un mese intero, altrimenti "01/10/2026 – 15/10/2026". */
export function periodLabel(p: Period): string {
  if (p.from === startOfMonth(p.from) && p.to === endOfMonth(p.from)) return `${monthName(Number(p.from.slice(5, 7)) - 1)} ${p.from.slice(0, 4)}`;
  if (p.from === p.to) return formatDateShort(p.from);
  return `${formatDateShort(p.from)} – ${formatDateShort(p.to)}`;
}

export function reportFilename(p: Period): string {
  return `skiwork-report-${p.from}_${p.to}.pdf`;
}

class Writer {
  doc = new PdfDoc();
  y = MARGIN;

  ensure(h: number): boolean {
    if (this.y + h <= BOTTOM) return false;
    this.doc.addPage();
    this.y = MARGIN;
    return true;
  }

  heading(title: string) {
    this.ensure(50);
    this.y += 14;
    this.doc.text(MARGIN, this.y, title, { size: 12.5, bold: true, color: ACCENT });
    this.y += 6;
    this.doc.line(MARGIN, this.y, MARGIN + CONTENT_W, this.y, 0.8, ACCENT);
    this.y += 14;
  }

  note(text: string) {
    for (const line of this.doc.wrap(text, CONTENT_W, 8)) {
      this.ensure(11);
      this.doc.text(MARGIN, this.y, line, { size: 8, color: MUTED });
      this.y += 11;
    }
  }

  table(cols: Column[], rows: string[][], opts: { total?: string[]; muted?: boolean[] } = {}) {
    const scale = CONTENT_W / cols.reduce((t, c) => t + c.width, 0);
    const widths = cols.map((c) => c.width * scale);
    const rowH = 15;
    const header = () => {
      this.doc.rect(MARGIN, this.y - 11, CONTENT_W, rowH, BAND);
      this.cells(cols, widths, cols.map((c) => c.label), { bold: true, size: 8, color: MUTED });
      this.y += rowH;
    };
    header();
    rows.forEach((r, i) => {
      if (this.ensure(rowH)) header();
      this.cells(cols, widths, r, { color: opts.muted?.[i] ? MUTED : undefined });
      this.doc.line(MARGIN, this.y + 4, MARGIN + CONTENT_W, this.y + 4, 0.3, [0.88, 0.88, 0.88]);
      this.y += rowH;
    });
    if (opts.total) {
      this.ensure(rowH);
      this.cells(cols, widths, opts.total, { bold: true });
      this.y += rowH;
    }
    this.y += 4;
  }

  private cells(cols: Column[], widths: number[], values: string[], o: { bold?: boolean; size?: number; color?: RGB }) {
    const size = o.size ?? 8.5;
    let x = MARGIN;
    cols.forEach((c, i) => {
      const w = widths[i]!;
      const text = this.doc.fit(values[i] ?? '', w - 8, size, o.bold);
      if (c.align === 'right') this.doc.text(x + w - 4, this.y, text, { size, bold: o.bold, color: o.color, align: 'right' });
      else this.doc.text(x + 4, this.y, text, { size, bold: o.bold, color: o.color });
      x += w;
    });
  }
}

const hours = formatMinutesAsHours;
const euro = formatEuro;

export function buildPeriodReport({ period, clientId, data, today }: ReportInput): Uint8Array {
  const w = new Writer();
  const doc = w.doc;
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const clientName = (id: string | null) => (id ? (clients.get(id)?.name ?? '—') : '—');
  const filter = { ...period, clientId };
  const s = summarize(filter, data);

  // Intestazione
  doc.rect(0, 0, PAGE_WIDTH, 92, ACCENT);
  doc.text(MARGIN, 40, 'SkiWork · Report attività', { size: 19, bold: true, color: [1, 1, 1] });
  const label = periodLabel(period);
  doc.text(MARGIN, 62, label.charAt(0).toUpperCase() + label.slice(1), { size: 12.5, color: [1, 1, 1] });
  doc.text(MARGIN, 79, `Committente: ${clientId ? clientName(clientId) : 'tutti'}`, { size: 9, color: [0.85, 0.9, 0.96] });
  doc.text(PAGE_WIDTH - MARGIN, 79, `Generato il ${formatDateShort(today)}`, { size: 9, color: [0.85, 0.9, 0.96], align: 'right' });
  w.y = 112;

  // Riepilogo
  w.heading('Riepilogo');
  const pct = s.collectedPct !== null ? `${s.collectedPct.toLocaleString('it-IT')}%` : '—';
  const kpis: [string, string, string?][] = [
    ['Ore lavorate', hours(s.workedMinutes.value), s.plannedMinutes.value > 0 ? `+ ${hours(s.plannedMinutes.value)} pianificate` : undefined],
    ['Compensi maturati', euro(s.accruedCents.value)],
    ['Compensi previsti', euro(s.expectedCents.value), 'non ancora maturati'],
    ['Compenso medio orario', s.avgHourlyCents !== null ? euro(s.avgHourlyCents) : '—', 'maturato / ore lavorate'],
    ['Fatturato', euro(s.invoicedCents.value)],
    ['Incassato', euro(s.collectedCents.value), `${pct} del fatturato`],
    ['Crediti residui', euro(s.outstandingCents.value), `al ${formatDateShort(period.to)}`],
    ['Rimborsi', euro(s.reimbursementsCents.value), 'separati dai compensi'],
    ['Spese', euro(s.expensesCents.value)],
    ['Accantonamenti', euro(s.setAsideCents.value)],
    ['Lezioni private', hours(s.privateLessonMinutes.value)],
    ['Allenamenti', hours(s.trainingMinutes.value)],
  ];
  const boxW = (CONTENT_W - 2 * 8) / 3;
  const boxH = 46;
  kpis.forEach(([k, v, sub], i) => {
    const col = i % 3;
    if (col === 0 && i > 0) w.y += boxH + 8;
    if (col === 0) w.ensure(boxH);
    const x = MARGIN + col * (boxW + 8);
    doc.rect(x, w.y, boxW, boxH, BAND);
    doc.text(x + 8, w.y + 14, k, { size: 8, color: MUTED });
    doc.text(x + 8, w.y + 30, v, { size: 13, bold: true });
    if (sub) doc.text(x + 8, w.y + 41, doc.fit(sub, boxW - 16, 7), { size: 7, color: MUTED });
  });
  w.y += boxH + 12;
  if (s.cancelledCount.value > 0) w.note(`Attività cancellate nel periodo: ${s.cancelledCount.value}.`);

  // Andamento mensile
  const months = splitByMonth(period);
  if (months.length > 1) {
    w.heading('Andamento mensile');
    const rows = months.map((p) => ({ p, m: summarize({ ...p, clientId }, data) }));
    w.table(
      [
        { label: 'Mese', width: 2 },
        { label: 'Ore', width: 1.3, align: 'right' },
        { label: 'Previsto', width: 1.6, align: 'right' },
        { label: 'Maturato', width: 1.6, align: 'right' },
        { label: 'Fatturato', width: 1.6, align: 'right' },
        { label: 'Incassato', width: 1.6, align: 'right' },
      ],
      rows.map(({ p, m }) => [`${monthName(Number(p.from.slice(5, 7)) - 1)} ${p.from.slice(0, 4)}`, hours(m.workedMinutes.value), euro(m.expectedCents.value), euro(m.accruedCents.value), euro(m.invoicedCents.value), euro(m.collectedCents.value)]),
      { total: ['Totale', hours(s.workedMinutes.value), euro(s.expectedCents.value), euro(s.accruedCents.value), euro(s.invoicedCents.value), euro(s.collectedCents.value)] },
    );
  }

  // Per committente
  if (!clientId) {
    const byClient = data.clients
      .map((c) => ({ c, s: summarize({ ...period, clientId: c.id }, data) }))
      .filter((x) => hasData(x.s));
    if (byClient.length > 0) {
      w.heading('Per committente');
      w.table(
        [
          { label: 'Committente', width: 2.6 },
          { label: 'Ore', width: 1.2, align: 'right' },
          { label: 'Maturato', width: 1.5, align: 'right' },
          { label: '€/h', width: 1.1, align: 'right' },
          { label: 'Fatturato', width: 1.5, align: 'right' },
          { label: 'Incassato', width: 1.5, align: 'right' },
        ],
        byClient.map(({ c, s: cs }) => [c.name, hours(cs.workedMinutes.value), euro(cs.accruedCents.value), cs.avgHourlyCents !== null ? euro(cs.avgHourlyCents) : '—', euro(cs.invoicedCents.value), euro(cs.collectedCents.value)]),
      );
    }
  }

  // Attività
  const activities = data.activities
    .filter((a) => a.date >= period.from && a.date <= period.to && isWorkType(a.type) && (!clientId || a.clientId === clientId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  w.heading(`Attività (${activities.length})`);
  if (activities.length === 0) w.note('Nessuna attività nel periodo.');
  else {
    const muted: boolean[] = [];
    const rows = activities.map((a) => {
      const c = computeActivity(a);
      const done = a.status === 'completed' || a.status === 'cancelled';
      muted.push(!done);
      const minutes = a.status === 'completed' ? c.workedMinutes : a.status === 'cancelled' ? 0 : c.plannedMinutes;
      const amount = done ? c.accruedCents : c.expectedCents;
      const what = a.title && a.title !== ACTIVITY_TYPE_LABEL[a.type] ? `${ACTIVITY_TYPE_LABEL[a.type]} · ${a.title}` : ACTIVITY_TYPE_LABEL[a.type];
      return [formatDateShort(a.date), `${a.start}–${a.end}`, what, clientName(a.clientId), ACTIVITY_STATUS_LABEL[a.status], minutes ? hours(minutes) : '—', amount ? euro(amount) : '—'];
    });
    w.table(
      [
        { label: 'Data', width: 1.25 },
        { label: 'Orario', width: 1.45 },
        { label: 'Attività', width: 2.8 },
        { label: 'Committente', width: 1.9 },
        { label: 'Stato', width: 1.3 },
        { label: 'Ore', width: 1, align: 'right' },
        { label: 'Compenso', width: 1.4, align: 'right' },
      ],
      rows,
      { muted, total: ['Totale maturato', '', '', '', '', hours(s.workedMinutes.value), euro(s.accruedCents.value)] },
    );
    if (muted.some(Boolean)) w.note('In grigio le attività non ancora completate: ore e compenso sono quelli previsti e non rientrano nel maturato.');
  }

  // Voci economiche
  const ledger = data.ledger.filter((l) => l.date >= period.from && l.date <= period.to && (!clientId || l.clientId === clientId)).sort((a, b) => a.date.localeCompare(b.date));
  if (ledger.length > 0) {
    w.heading('Rimborsi, spese e accantonamenti');
    w.table(
      [
        { label: 'Data', width: 1.2 },
        { label: 'Tipo', width: 1.5 },
        { label: 'Committente', width: 2 },
        { label: 'Descrizione', width: 3.5 },
        { label: 'Importo', width: 1.4, align: 'right' },
      ],
      ledger.map((l) => [formatDateShort(l.date), LEDGER_KIND_LABEL[l.kind], clientName(l.clientId), l.description, euro(l.amountCents)]),
    );
  }

  // Documenti emessi nel periodo
  const documents = data.documents
    .filter((d) => d.status === 'issued' && d.issueDate !== null && d.issueDate >= period.from && d.issueDate <= period.to && (!clientId || d.clientId === clientId))
    .sort((a, b) => a.issueDate!.localeCompare(b.issueDate!));
  if (documents.length > 0) {
    w.heading('Documenti emessi');
    w.table(
      [
        { label: 'Data', width: 1.2 },
        { label: 'Numero', width: 1.5 },
        { label: 'Committente', width: 2.3 },
        { label: 'Scadenza', width: 1.2 },
        { label: 'Stato', width: 1.7 },
        { label: 'Importo', width: 1.4, align: 'right' },
      ],
      documents.map((d) => [formatDateShort(d.issueDate!), [d.kind, d.number].filter(Boolean).join(' '), clientName(d.clientId), d.dueDate ? formatDateShort(d.dueDate) : '—', DOCUMENT_STATUS_LABEL[documentStatus(d, data.payments, today)], euro(d.amountCents)]),
      { total: ['Totale', '', '', '', '', euro(s.invoicedCents.value)] },
    );
  }

  // Incassi nel periodo
  const payments = data.payments.filter((p) => p.date >= period.from && p.date <= period.to && (!clientId || p.clientId === clientId)).sort((a, b) => a.date.localeCompare(b.date));
  if (payments.length > 0) {
    const docs = new Map(data.documents.map((d) => [d.id, d]));
    w.heading('Incassi');
    w.table(
      [
        { label: 'Data', width: 1.2 },
        { label: 'Committente', width: 2.3 },
        { label: 'Documento', width: 1.8 },
        { label: 'Metodo', width: 2 },
        { label: 'Importo', width: 1.4, align: 'right' },
      ],
      payments.map((p) => {
        const d = p.documentId ? docs.get(p.documentId) : undefined;
        return [formatDateShort(p.date), clientName(p.clientId), d ? [d.kind, d.number].filter(Boolean).join(' ') : '—', p.method, euro(p.amountCents)];
      }),
      { total: ['Totale', '', '', '', euro(s.collectedCents.value)] },
    );
  }

  w.y += 6;
  w.note('Valori ricalcolati dalle registrazioni di SkiWork. Il maturato comprende le attività completate e gli eventuali compensi di cancellazione; i rimborsi sono esclusi dai compensi. Documento ad uso personale, non ha valore fiscale.');

  // Piè di pagina
  const total = doc.pageCount;
  for (let i = 0; i < total; i++) {
    doc.setPage(i);
    doc.line(MARGIN, PAGE_HEIGHT - 32, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 32, 0.4);
    doc.text(MARGIN, PAGE_HEIGHT - 20, `SkiWork · ${periodLabel(period)}`, { size: 7.5, color: MUTED });
    doc.text(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 20, `Pagina ${i + 1} di ${total}`, { size: 7.5, color: MUTED, align: 'right' });
  }

  return doc.build(`SkiWork – Report ${periodLabel(period)}`);
}

function hasData(s: Summary): boolean {
  return s.workedMinutes.value > 0 || s.accruedCents.value !== 0 || s.expectedCents.value !== 0 || s.collectedCents.value !== 0 || s.invoicedCents.value !== 0;
}
