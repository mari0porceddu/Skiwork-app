/**
 * Report derivati dalle registrazioni: nessun totale viene memorizzato,
 * ogni valore è ricalcolato e riconducibile agli ID delle registrazioni che lo compongono.
 */
import { computeActivity } from './compensation';
import { outstandingDocuments } from './documents';
import { sumCents, type Cents } from './money';
import type { ISODate } from './time';
import type { Activity, ActivityType, LedgerEntry, Payment, WorkDocument } from './types';
import { isWorkType } from './types';

export interface Period {
  from: ISODate;
  to: ISODate;
}

export interface Filter extends Period {
  clientId?: string | null;
}

export interface Metric<T = number> {
  value: T;
  ids: string[];
}

export interface Summary {
  workedMinutes: Metric;
  plannedMinutes: Metric;
  privateLessonMinutes: Metric;
  trainingMinutes: Metric;
  expectedCents: Metric;
  accruedCents: Metric;
  cancelledCount: Metric;
  invoicedCents: Metric;
  collectedCents: Metric;
  outstandingCents: Metric;
  reimbursementsCents: Metric;
  expensesCents: Metric;
  setAsideCents: Metric;
  /** Compenso medio orario maturato (centesimi/ora), null se zero ore. */
  avgHourlyCents: number | null;
  /** Percentuale di crediti incassati sul fatturato del periodo (0-100), null se nessun fatturato. */
  collectedPct: number | null;
}

const inPeriod = (d: ISODate | null, p: Period) => d !== null && d >= p.from && d <= p.to;
const byClient = (clientId: string | null | undefined, f: Filter) => f.clientId == null || clientId === f.clientId;

function metric(): Metric {
  return { value: 0, ids: [] };
}

export function activityMinutesByType(a: Activity, type: ActivityType): number {
  if (a.type !== type || a.status !== 'completed') return 0;
  return computeActivity(a).workedMinutes;
}

export function summarize(
  f: Filter,
  data: { activities: Activity[]; ledger: LedgerEntry[]; documents: WorkDocument[]; payments: Payment[] },
): Summary {
  const s: Summary = {
    workedMinutes: metric(),
    plannedMinutes: metric(),
    privateLessonMinutes: metric(),
    trainingMinutes: metric(),
    expectedCents: metric(),
    accruedCents: metric(),
    cancelledCount: metric(),
    invoicedCents: metric(),
    collectedCents: metric(),
    outstandingCents: metric(),
    reimbursementsCents: metric(),
    expensesCents: metric(),
    setAsideCents: metric(),
    avgHourlyCents: null,
    collectedPct: null,
  };
  const add = (m: Metric, v: number, id: string) => {
    if (v === 0) return;
    m.value += v;
    m.ids.push(id);
  };

  for (const a of data.activities) {
    if (!inPeriod(a.date, f) || !byClient(a.clientId, f) || !isWorkType(a.type)) continue;
    const c = computeActivity(a);
    if (a.status === 'completed') {
      add(s.workedMinutes, c.workedMinutes, a.id);
      if (a.type === 'private_lesson') add(s.privateLessonMinutes, c.workedMinutes, a.id);
      if (a.type === 'training') add(s.trainingMinutes, c.workedMinutes, a.id);
      add(s.accruedCents, c.accruedCents, a.id);
    } else if (a.status === 'cancelled') {
      add(s.cancelledCount, 1, a.id);
      add(s.accruedCents, c.accruedCents, a.id);
    } else {
      add(s.plannedMinutes, c.plannedMinutes, a.id);
      add(s.expectedCents, c.expectedCents, a.id);
    }
  }

  for (const e of data.ledger) {
    if (!inPeriod(e.date, f) || !byClient(e.clientId, f)) continue;
    if (e.kind === 'reimbursement') add(s.reimbursementsCents, e.amountCents, e.id);
    else if (e.kind === 'expense') add(s.expensesCents, e.amountCents, e.id);
    else add(s.setAsideCents, e.amountCents, e.id);
  }

  for (const d of data.documents) {
    if (d.status !== 'issued' || !inPeriod(d.issueDate, f) || !byClient(d.clientId, f)) continue;
    add(s.invoicedCents, d.amountCents, d.id);
  }

  for (const p of data.payments) {
    if (!inPeriod(p.date, f) || !byClient(p.clientId, f)) continue;
    add(s.collectedCents, p.amountCents, p.id);
  }

  // Crediti residui: tutti i documenti emessi fino alla fine del periodo con saldo aperto,
  // considerando i pagamenti registrati fino alla fine del periodo.
  const paymentsUntil = data.payments.filter((p) => p.date <= f.to);
  const docsUntil = data.documents.filter((d) => d.issueDate !== null && d.issueDate <= f.to && byClient(d.clientId, f));
  for (const { doc, balance } of outstandingDocuments(docsUntil, paymentsUntil)) add(s.outstandingCents, balance, doc.id);

  s.avgHourlyCents = s.workedMinutes.value > 0 ? Math.round((s.accruedCents.value * 60) / s.workedMinutes.value) : null;
  s.collectedPct = s.invoicedCents.value > 0 ? Math.round((s.collectedCents.value / s.invoicedCents.value) * 1000) / 10 : null;
  return s;
}

/** Totali per giorno (per i grafici e il dettaglio giornaliero). */
export function accruedByDay(activities: Activity[], p: Period): Map<ISODate, Cents> {
  const map = new Map<ISODate, Cents>();
  for (const a of activities) {
    if (!inPeriod(a.date, p)) continue;
    const c = computeActivity(a).accruedCents;
    if (c !== 0) map.set(a.date, (map.get(a.date) ?? 0) + c);
  }
  return map;
}

export function totalAccrued(activities: Activity[]): Cents {
  return sumCents(activities.map((a) => computeActivity(a).accruedCents));
}
