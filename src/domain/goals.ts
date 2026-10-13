/** Obiettivi: valore attuale, residuo, ritmo necessario e previsione. Solo dati consuntivi. */
import { computeActivity } from './compensation';
import { addDays, datesInRange, diffDays, type ISODate } from './time';
import type { Activity, Goal, Payment } from './types';
import { isWorkType } from './types';

export interface GoalProgress {
  current: number;
  target: number;
  remaining: number;
  /** 0-100+ */
  pct: number;
  daysTotal: number;
  daysElapsed: number;
  daysLeft: number;
  /** Quantità al giorno necessaria nei giorni rimanenti (null se periodo concluso o obiettivo raggiunto). */
  requiredPerDay: number | null;
  /** Proiezione lineare a fine periodo sul ritmo attuale. */
  projected: number | null;
  /** Data prevista di raggiungimento sul ritmo attuale (null se non stimabile). */
  forecastDate: ISODate | null;
  status: 'reached' | 'on_track' | 'behind' | 'not_started' | 'ended';
}

/** Valore attuale dell'obiettivo calcolato fino a "today" incluso. Gli importi previsti non contano. */
export function goalCurrentValue(goal: Goal, activities: Activity[], payments: Payment[], today: ISODate): number {
  const to = today < goal.periodTo ? today : goal.periodTo;
  const inRange = (d: ISODate) => d >= goal.periodFrom && d <= to;
  const matchClient = (c: string | null) => goal.clientId === null || c === goal.clientId;
  const done = activities.filter((a) => a.status === 'completed' && inRange(a.date) && matchClient(a.clientId) && isWorkType(a.type));

  switch (goal.metric) {
    case 'private_lesson_hours':
      return done.filter((a) => a.type === 'private_lesson').reduce((s, a) => s + computeActivity(a).workedMinutes, 0);
    case 'training_hours':
      return done.filter((a) => a.type === 'training').reduce((s, a) => s + computeActivity(a).workedMinutes, 0);
    case 'worked_hours':
      return done.reduce((s, a) => s + computeActivity(a).workedMinutes, 0);
    case 'accrued':
      return activities
        .filter((a) => (a.status === 'completed' || a.status === 'cancelled') && inRange(a.date) && matchClient(a.clientId))
        .reduce((s, a) => s + computeActivity(a).accruedCents, 0);
    case 'collected':
      return payments.filter((p) => inRange(p.date) && matchClient(p.clientId)).reduce((s, p) => s + p.amountCents, 0);
    case 'worked_days':
      return new Set(done.map((a) => a.date)).size;
    case 'free_days': {
      if (to < goal.periodFrom) return 0;
      const worked = new Set(done.map((a) => a.date));
      return datesInRange(goal.periodFrom, to).filter((d) => !worked.has(d)).length;
    }
  }
}

export function goalProgress(goal: Goal, current: number, today: ISODate): GoalProgress {
  const daysTotal = diffDays(goal.periodFrom, goal.periodTo) + 1;
  const daysElapsed = Math.min(daysTotal, Math.max(0, diffDays(goal.periodFrom, today) + 1));
  const daysLeft = daysTotal - daysElapsed;
  const remaining = Math.max(0, goal.target - current);
  const pct = goal.target > 0 ? Math.round((current / goal.target) * 1000) / 10 : 0;
  const pace = daysElapsed > 0 ? current / daysElapsed : 0;
  const projected = daysElapsed > 0 ? Math.round(pace * daysTotal) : null;

  let forecastDate: ISODate | null = null;
  if (remaining === 0) forecastDate = null;
  else if (pace > 0) forecastDate = addDays(goal.periodFrom, Math.ceil(goal.target / pace) - 1);

  let status: GoalProgress['status'];
  if (current >= goal.target) status = 'reached';
  else if (daysElapsed === 0) status = 'not_started';
  else if (daysLeft === 0) status = 'ended';
  else status = projected !== null && projected >= goal.target ? 'on_track' : 'behind';

  return {
    current,
    target: goal.target,
    remaining,
    pct,
    daysTotal,
    daysElapsed,
    daysLeft,
    requiredPerDay: remaining > 0 && daysLeft > 0 ? remaining / daysLeft : null,
    projected,
    forecastDate,
    status,
  };
}

export function goalUnit(metric: Goal['metric']): 'minutes' | 'cents' | 'days' {
  if (metric === 'accrued' || metric === 'collected') return 'cents';
  if (metric === 'worked_days' || metric === 'free_days') return 'days';
  return 'minutes';
}
