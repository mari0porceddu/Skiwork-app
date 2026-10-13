import { describe, expect, it } from 'vitest';
import { computeActivity, computeRateAmount, findApplicableRate, roundMinutes, toAppliedRate } from '../src/domain/compensation';
import { applyBps, parseEuroToCents, roundHalfAwayFromZero } from '../src/domain/money';
import { summarize } from '../src/domain/reports';
import { activity, doc, hourly, payment, rate } from './fixtures';

const empty = { activities: [], ledger: [], documents: [], payments: [] };
const JAN = { from: '2026-01-01', to: '2026-01-31' };

describe('compensi', () => {
  it('due ore a 50 €/ora producono 100 €', () => {
    const r = computeActivity(activity({ start: '09:00', end: '11:00', rate: hourly(5000) }));
    expect(r.accruedCents).toBe(10000);
    expect(r.workedMinutes).toBe(120);
  });

  it('le attività pianificate o confermate non sono compensi maturati', () => {
    for (const status of ['planned', 'confirmed'] as const) {
      const r = computeActivity(activity({ status }));
      expect(r.accruedCents).toBe(0);
      expect(r.expectedCents).toBe(10000);
      expect(r.workedMinutes).toBe(0);
    }
    const s = summarize(JAN, { ...empty, activities: [activity({ status: 'planned' })] });
    expect(s.accruedCents.value).toBe(0);
    expect(s.expectedCents.value).toBe(10000);
    expect(s.workedMinutes.value).toBe(0);
  });

  it('le attività cancellate non generano ore lavorate; solo il compenso di cancellazione', () => {
    const r = computeActivity(activity({ status: 'cancelled', cancellationFeeCents: 2500 }));
    expect(r.workedMinutes).toBe(0);
    expect(r.plannedMinutes).toBe(0);
    expect(r.expectedCents).toBe(0);
    expect(r.accruedCents).toBe(2500);
    const s = summarize(JAN, { ...empty, activities: [activity({ status: 'cancelled' })] });
    expect(s.workedMinutes.value).toBe(0);
    expect(s.accruedCents.value).toBe(0);
    expect(s.cancelledCount.value).toBe(1);
  });

  it('i compensi non incassati non sono inclusi negli incassi', () => {
    const s = summarize(JAN, { ...empty, activities: [activity()], documents: [doc({ amountCents: 10000 })] });
    expect(s.accruedCents.value).toBe(10000);
    expect(s.invoicedCents.value).toBe(10000);
    expect(s.collectedCents.value).toBe(0);
    expect(s.outstandingCents.value).toBe(10000);
  });

  it('i pagamenti parziali riducono il credito residuo', () => {
    const data = { ...empty, documents: [doc({ amountCents: 100000 })], payments: [payment({ amountCents: 40000, date: '2026-01-31' })] };
    const s = summarize(JAN, data);
    expect(s.collectedCents.value).toBe(40000);
    expect(s.outstandingCents.value).toBe(60000);
    expect(s.collectedPct).toBe(40);
    const s2 = summarize(JAN, { ...data, payments: [...data.payments, payment({ id: 'p2', amountCents: 60000, date: '2026-01-31' })] });
    expect(s2.outstandingCents.value).toBe(0);
  });

  it('le modifiche tariffarie non alterano i dati storici (snapshot)', () => {
    const r = rate({ amountCents: 5000 });
    const a = activity({ rate: toAppliedRate(r) });
    // la tariffa configurata cambia dopo la registrazione
    r.amountCents = 7000;
    expect(computeActivity(a).accruedCents).toBe(10000);
  });

  it('la tariffa applicabile rispetta validità e tipologia', () => {
    const rates = [
      rate({ id: 'old', validFrom: '2025-01-01', validTo: '2025-12-31', amountCents: 4000 }),
      rate({ id: 'gen', validFrom: '2026-01-01', amountCents: 5000 }),
      rate({ id: 'train', activityType: 'training', validFrom: '2026-01-01', amountCents: 2000 }),
    ];
    expect(findApplicableRate(rates, 'school', 'private_lesson', '2025-06-01')?.id).toBe('old');
    expect(findApplicableRate(rates, 'school', 'private_lesson', '2026-02-01')?.id).toBe('gen');
    expect(findApplicableRate(rates, 'school', 'training', '2026-02-01')?.id).toBe('train');
    expect(findApplicableRate(rates, 'other', 'training', '2026-02-01')).toBeNull();
  });

  it('i rimborsi sono separati dai compensi', () => {
    const s = summarize(JAN, {
      ...empty,
      activities: [activity()],
      ledger: [{ id: 'l1', kind: 'reimbursement', clientId: 'school', activityId: 'a1', date: '2026-01-10', amountCents: 1500, description: 'Skipass', createdAt: '', updatedAt: '' }],
    });
    expect(s.accruedCents.value).toBe(10000);
    expect(s.reimbursementsCents.value).toBe(1500);
  });

  it('arrotondamenti coerenti (half away from zero al centesimo)', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(100.49999)).toBe(100);
    // 50 minuti a 33,33 €/h = 2777,5 cent -> 2778
    expect(computeRateAmount(hourly(3333), 50, 1).total).toBe(2778);
    // 10% di 0,05 € = 0,5 cent -> 1 cent
    expect(applyBps(5, 1000)).toBe(1);
    // il totale di più attività è la somma dei singoli importi arrotondati
    const s = summarize(JAN, { ...empty, activities: [activity({ id: 'x', end: '09:50', rate: hourly(3333) }), activity({ id: 'y', end: '09:50', rate: hourly(3333) })] });
    expect(s.accruedCents.value).toBe(2778 * 2);
  });

  it('arrotondamento dei minuti configurabile', () => {
    expect(roundMinutes(52, 15, 'nearest')).toBe(45);
    expect(roundMinutes(53, 15, 'nearest')).toBe(60);
    expect(roundMinutes(46, 15, 'up')).toBe(60);
    expect(roundMinutes(59, 15, 'down')).toBe(45);
    expect(roundMinutes(59, 15, 'none')).toBe(59);
    const r = computeActivity(activity({ start: '09:00', end: '09:50', rate: hourly(6000, { roundingStepMinutes: 30, roundingMode: 'up' }) }));
    expect(r.recognizedMinutes).toBe(60);
    expect(r.accruedCents).toBe(6000);
  });

  it('pause, ore effettive e correzioni manuali', () => {
    const r = computeActivity(activity({ start: '09:00', end: '13:00', breakMinutes: 30, actualMinutes: null }));
    expect(r.plannedMinutes).toBe(210);
    expect(r.accruedCents).toBe(17500);
    const incomplete = computeActivity(activity({ start: '09:00', end: '11:00', actualMinutes: 60 }));
    expect(incomplete.expectedCents).toBe(10000);
    expect(incomplete.accruedCents).toBe(5000);
    const adj = computeActivity(activity({ manualAdjustmentCents: -1000 }));
    expect(adj.accruedCents).toBe(9000);
    expect(adj.lines.at(-1)).toEqual({ label: 'Correzione manuale', cents: -1000 });
  });

  it('tariffe per lezione, giornaliere, commissioni, maggiorazioni e trattenute', () => {
    const lesson = { ...hourly(4500), mode: 'per_lesson' as const };
    expect(computeRateAmount(lesson, 999, 2).total).toBe(9000);
    const daily = { ...hourly(15000), mode: 'daily' as const, commissionBps: 2000, fixedDeductionCents: 500 };
    // 150 - 20% = 120 - 5 = 115
    expect(computeRateAmount(daily, 480, 1).total).toBe(11500);
    // 2 h a 40 € = 80 + 10% = 88 - 25% = 66
    const r = computeRateAmount(hourly(4000, { surchargeBps: 1000, commissionBps: 2500 }), 120, 1);
    expect(r.total).toBe(6600);
    expect(r.lines.map((l) => l.cents)).toEqual([8000, 800, -2200]);
  });

  it('allenamento ASD: ore dagli orari effettivi × tariffa configurata', () => {
    const r = computeActivity(activity({ type: 'training', clientId: 'asd', start: '17:30', end: '19:15', rate: hourly(1800) }));
    expect(r.workedMinutes).toBe(105);
    expect(r.accruedCents).toBe(3150);
  });

  it('attività a cavallo della mezzanotte', () => {
    const r = computeActivity(activity({ start: '22:00', end: '01:00' }));
    expect(r.workedMinutes).toBe(180);
    expect(r.accruedCents).toBe(15000);
  });

  it('parsing degli importi', () => {
    expect(parseEuroToCents('50')).toBe(5000);
    expect(parseEuroToCents('12,5')).toBe(1250);
    expect(parseEuroToCents('1.234,56')).toBe(123456);
    expect(parseEuroToCents('12.50')).toBe(1250);
    expect(parseEuroToCents('abc')).toBeNull();
    expect(parseEuroToCents('1,234')).toBeNull();
  });

  it('ogni totale è riconducibile alle registrazioni', () => {
    const s = summarize(JAN, { ...empty, activities: [activity({ id: 'x' }), activity({ id: 'y', status: 'planned' }), activity({ id: 'z', date: '2026-02-01' })] });
    expect(s.accruedCents.ids).toEqual(['x']);
    expect(s.expectedCents.ids).toEqual(['y']);
  });

  it('filtro per committente', () => {
    const s = summarize({ ...JAN, clientId: 'asd' }, { ...empty, activities: [activity({ id: 'x' }), activity({ id: 'y', clientId: 'asd', type: 'training' })] });
    expect(s.accruedCents.ids).toEqual(['y']);
    expect(s.trainingMinutes.value).toBe(120);
  });
});
