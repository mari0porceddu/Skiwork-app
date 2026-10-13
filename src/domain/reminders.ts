/**
 * Promemoria deterministici calcolati dai dati (mostrati nell'app).
 * Ogni promemoria ha un ID stabile derivato dall'oggetto e dalla regola,
 * così riavvii, modifiche o importazioni non generano duplicati.
 */
import { documentBalance, documentStatus } from './documents';
import { formatEuro } from './money';
import { absInterval, addDays, dayIndex, MINUTES_PER_DAY, timeToMinutes, type ISODate } from './time';
import { detectConflicts } from './schedule';
import type { FiscalDeadline } from './fiscal';
import type { Activity, Client, Payment, WorkDocument } from './types';
import { ACTIVITY_TYPE_LABEL } from './types';

export type ReminderCategory =
  | 'upcoming'
  | 'unconfirmed'
  | 'conflict'
  | 'to_complete'
  | 'document_todo'
  | 'payment_due'
  | 'overdue'
  | 'fiscal_deadline';

export const REMINDER_CATEGORY_LABEL: Record<ReminderCategory, string> = {
  upcoming: 'Impegni imminenti',
  unconfirmed: 'Lezioni non confermate',
  conflict: 'Conflitti nel calendario',
  to_complete: 'Attività da consuntivare',
  document_todo: 'Documenti da preparare o emettere',
  payment_due: 'Pagamenti in scadenza',
  overdue: 'Crediti scaduti',
  fiscal_deadline: 'Scadenze fiscali',
};

export interface ReminderSettings {
  enabled: Record<ReminderCategory, boolean>;
  /** Anticipo in ore per impegni imminenti e lezioni non confermate. */
  upcomingHours: number;
  /** Anticipo in giorni per pagamenti in scadenza. */
  paymentDueDays: number;
  /** Anticipo in giorni per scadenze fiscali. */
  fiscalDueDays: number;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: { upcoming: true, unconfirmed: true, conflict: true, to_complete: true, document_todo: true, payment_due: true, overdue: true, fiscal_deadline: true },
  upcomingHours: 24,
  paymentDueDays: 7,
  fiscalDueDays: 14,
};

export interface Reminder {
  id: string;
  category: ReminderCategory;
  title: string;
  detail: string;
  date: ISODate;
  /** Oggetto collegato per l'apertura. */
  ref: { entity: 'activity' | 'document' | 'fiscal_deadline'; id: string };
  severity: 'info' | 'warning' | 'danger';
}

export function computeReminders(
  input: { activities: Activity[]; documents: WorkDocument[]; payments: Payment[]; clients: Client[]; fiscalDeadlines?: FiscalDeadline[] },
  now: { date: ISODate; time: string },
  settings: ReminderSettings = DEFAULT_REMINDER_SETTINGS,
  defaultTravel = 0,
): Reminder[] {
  const out: Reminder[] = [];
  const nowAbs = dayIndex(now.date) * MINUTES_PER_DAY + timeToMinutes(now.time);
  const horizon = nowAbs + settings.upcomingHours * 60;
  const clientMap = new Map(input.clients.map((c) => [c.id, c]));
  const name = (id: string | null) => (id ? (clientMap.get(id)?.name ?? '') : '');
  const label = (a: Activity) => a.title || ACTIVITY_TYPE_LABEL[a.type];

  for (const a of input.activities) {
    if (a.status === 'cancelled') continue;
    const iv = absInterval(a.date, a.start, a.end);
    if (settings.enabled.upcoming && a.status !== 'completed' && iv.start >= nowAbs && iv.start <= horizon) {
      out.push({ id: `upcoming:${a.id}:${a.date}T${a.start}`, category: 'upcoming', title: label(a), detail: `${a.date} ${a.start} ${name(a.clientId)}`.trim(), date: a.date, ref: { entity: 'activity', id: a.id }, severity: 'info' });
    }
    if (settings.enabled.unconfirmed && a.status === 'planned' && iv.start >= nowAbs && iv.start <= horizon) {
      out.push({ id: `unconfirmed:${a.id}`, category: 'unconfirmed', title: `Da confermare: ${label(a)}`, detail: `${a.date} ${a.start}`, date: a.date, ref: { entity: 'activity', id: a.id }, severity: 'warning' });
    }
    if (settings.enabled.to_complete && (a.status === 'planned' || a.status === 'confirmed') && a.type !== 'personal' && iv.end <= nowAbs) {
      out.push({ id: `to_complete:${a.id}`, category: 'to_complete', title: `Segna come completata o cancellata: ${label(a)}`, detail: `${a.date} ${a.start}–${a.end}`, date: a.date, ref: { entity: 'activity', id: a.id }, severity: 'warning' });
    }
  }

  if (settings.enabled.conflict) {
    const future = input.activities.filter((a) => a.date >= addDays(now.date, -1));
    for (const c of detectConflicts(future, clientMap, defaultTravel)) {
      const a = input.activities.find((x) => x.id === c.aId)!;
      const b = input.activities.find((x) => x.id === c.bId)!;
      out.push({
        id: `conflict:${[c.aId, c.bId].sort().join(':')}`,
        category: 'conflict',
        title: c.kind === 'overlap' ? 'Impegni sovrapposti' : 'Tempo di trasferimento insufficiente',
        detail: `${label(a)} (${a.date} ${a.start}) ↔ ${label(b)} (${b.date} ${b.start})`,
        date: b.date,
        ref: { entity: 'activity', id: b.id },
        severity: 'danger',
      });
    }
  }

  for (const d of input.documents) {
    const st = documentStatus(d, input.payments, now.date);
    if (settings.enabled.document_todo && (st === 'to_verify' || st === 'to_prepare' || st === 'to_issue')) {
      out.push({ id: `document_todo:${d.id}:${st}`, category: 'document_todo', title: `${d.kind || 'Documento'} ${d.number}`.trim() + ` — ${st === 'to_issue' ? 'da emettere' : st === 'to_prepare' ? 'da preparare' : 'da verificare'}`, detail: name(d.clientId), date: d.issueDate ?? now.date, ref: { entity: 'document', id: d.id }, severity: 'info' });
    }
    if (st === 'overdue' && settings.enabled.overdue) {
      out.push({ id: `overdue:${d.id}`, category: 'overdue', title: `Credito scaduto: ${d.number || d.kind}`, detail: `${name(d.clientId)} · residuo ${formatEuro(documentBalance(d, input.payments))} · scadenza ${d.dueDate}`, date: d.dueDate!, ref: { entity: 'document', id: d.id }, severity: 'danger' });
    } else if ((st === 'issued' || st === 'partially_paid') && settings.enabled.payment_due && d.dueDate && d.dueDate <= addDays(now.date, settings.paymentDueDays)) {
      out.push({ id: `payment_due:${d.id}:${d.dueDate}`, category: 'payment_due', title: `Pagamento in scadenza: ${d.number || d.kind}`, detail: `${name(d.clientId)} · residuo ${formatEuro(documentBalance(d, input.payments))} · scadenza ${d.dueDate}`, date: d.dueDate, ref: { entity: 'document', id: d.id }, severity: 'warning' });
    }
  }

  if (settings.enabled.fiscal_deadline) {
    for (const f of input.fiscalDeadlines ?? []) {
      if (f.done || f.date > addDays(now.date, settings.fiscalDueDays ?? 14)) continue;
      out.push({ id: `fiscal_deadline:${f.id}:${f.date}`, category: 'fiscal_deadline', title: f.title, detail: `${f.date}${f.amountCents !== null ? ` · ${formatEuro(f.amountCents)}` : ''}`, date: f.date, ref: { entity: 'fiscal_deadline', id: f.id }, severity: f.date < now.date ? 'danger' : 'warning' });
    }
  }

  const sev = { danger: 0, warning: 1, info: 2 } as const;
  return out.sort((x, y) => sev[x.severity] - sev[y.severity] || x.date.localeCompare(y.date));
}
