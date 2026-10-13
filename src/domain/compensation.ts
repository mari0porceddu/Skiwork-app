/**
 * Motore dei compensi. Funzioni pure, senza dipendenze dall'interfaccia o dal database.
 * Le formule sono documentate in docs/CALCOLI.md.
 */
import { applyBps, roundHalfAwayFromZero, type Cents } from './money';
import { spanMinutes, type ISODate } from './time';
import type { Activity, ActivityType, AppliedRate, Rate, RateTerms } from './types';

export interface CompensationLine {
  label: string;
  cents: Cents;
}

export interface CompensationResult {
  /** Minuti lordi tra inizio e fine. */
  spanMinutes: number;
  /** Minuti previsti = durata - pause. */
  plannedMinutes: number;
  /** Minuti effettivi lavorati (solo attività completate), prima dell'arrotondamento. */
  workedMinutes: number;
  /** Minuti riconosciuti ai fini del compenso, dopo l'arrotondamento. */
  recognizedMinutes: number;
  /** Compenso previsto (pianificato/confermato) calcolato sulle ore previste. */
  expectedCents: Cents;
  /** Compenso maturato: solo attività completate o compensi di cancellazione. */
  accruedCents: Cents;
  /** Dettaglio delle voci che compongono il compenso maturato (o previsto se non completata). */
  lines: CompensationLine[];
}

export function roundMinutes(minutes: number, step: number, mode: RateTerms['roundingMode']): number {
  if (mode === 'none' || step <= 1) return minutes;
  const q = minutes / step;
  const n = mode === 'up' ? Math.ceil(q) : mode === 'down' ? Math.floor(q) : Math.round(q);
  return n * step;
}

/**
 * Calcola l'importo per una regola tariffaria.
 * - Oraria: base = arrotonda(minuti × tariffa / 60)
 * - Per lezione / giornaliera: base = tariffa × unità
 * Poi: maggiorazione = base × %magg; commissione = (base + maggiorazione) × %comm;
 * netto = base + maggiorazione − commissione − trattenuta fissa.
 */
export function computeRateAmount(terms: RateTerms, minutes: number, units: number): { total: Cents; lines: CompensationLine[] } {
  const lines: CompensationLine[] = [];
  let base: Cents;
  if (terms.mode === 'hourly') {
    base = roundHalfAwayFromZero((minutes * terms.amountCents) / 60);
    lines.push({ label: `Base oraria (${(minutes / 60).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h)`, cents: base });
  } else {
    base = terms.amountCents * units;
    lines.push({ label: terms.mode === 'per_lesson' ? `Base per lezione (× ${units})` : `Base giornaliera (× ${units})`, cents: base });
  }
  const surcharge = applyBps(base, terms.surchargeBps);
  if (surcharge !== 0) lines.push({ label: 'Maggiorazione', cents: surcharge });
  const commission = applyBps(base + surcharge, terms.commissionBps);
  if (commission !== 0) lines.push({ label: 'Commissione', cents: -commission });
  if (terms.fixedDeductionCents !== 0) lines.push({ label: 'Trattenuta fissa', cents: -terms.fixedDeductionCents });
  const total = base + surcharge - commission - terms.fixedDeductionCents;
  return { total, lines };
}

type ActivityEconomicFields = Pick<
  Activity,
  'start' | 'end' | 'breakMinutes' | 'actualMinutes' | 'units' | 'status' | 'rate' | 'manualAdjustmentCents' | 'cancellationFeeCents'
>;

export function computeActivity(a: ActivityEconomicFields): CompensationResult {
  const span = spanMinutes(a.start, a.end);
  const planned = Math.max(0, span - Math.max(0, a.breakMinutes));
  const empty: CompensationResult = {
    spanMinutes: span,
    plannedMinutes: planned,
    workedMinutes: 0,
    recognizedMinutes: 0,
    expectedCents: 0,
    accruedCents: 0,
    lines: [],
  };

  if (a.status === 'cancelled') {
    // Nessuna ora lavorata; solo l'eventuale compenso di cancellazione.
    const lines = a.cancellationFeeCents !== 0 ? [{ label: 'Compenso di cancellazione', cents: a.cancellationFeeCents }] : [];
    return { ...empty, plannedMinutes: 0, accruedCents: a.cancellationFeeCents, lines };
  }

  const rate: AppliedRate | null = a.rate;
  const units = Math.max(0, a.units);
  const expected = rate ? computeRateAmount(rate, rate.mode === 'hourly' ? roundMinutes(planned, rate.roundingStepMinutes, rate.roundingMode) : planned, units) : { total: 0, lines: [] };

  if (a.status !== 'completed') {
    return { ...empty, expectedCents: expected.total, lines: expected.lines };
  }

  const worked = a.actualMinutes ?? planned;
  const recognized = rate && rate.mode === 'hourly' ? roundMinutes(worked, rate.roundingStepMinutes, rate.roundingMode) : worked;
  const accrued = rate ? computeRateAmount(rate, recognized, units) : { total: 0, lines: [] };
  const lines = [...accrued.lines];
  if (a.manualAdjustmentCents !== 0) lines.push({ label: 'Correzione manuale', cents: a.manualAdjustmentCents });
  return {
    spanMinutes: span,
    plannedMinutes: planned,
    workedMinutes: worked,
    recognizedMinutes: recognized,
    expectedCents: expected.total,
    accruedCents: accrued.total + a.manualAdjustmentCents,
    lines,
  };
}

/** Una tariffa è valida in una data se validFrom <= data <= validTo (validTo null = senza scadenza). */
export function isRateValidOn(rate: Rate, date: ISODate): boolean {
  return rate.validFrom <= date && (rate.validTo === null || date <= rate.validTo);
}

/**
 * Trova la tariffa applicabile: stesso committente, valida nella data;
 * si preferisce quella specifica per la tipologia rispetto a quella generica,
 * poi quella con inizio validità più recente.
 */
export function findApplicableRate(rates: Rate[], clientId: string, type: ActivityType, date: ISODate): Rate | null {
  const candidates = rates.filter(
    (r) => r.clientId === clientId && (r.activityType === null || r.activityType === type) && isRateValidOn(r, date),
  );
  candidates.sort((a, b) => {
    const spec = Number(b.activityType !== null) - Number(a.activityType !== null);
    if (spec !== 0) return spec;
    return b.validFrom.localeCompare(a.validFrom);
  });
  return candidates[0] ?? null;
}

export function toAppliedRate(rate: Rate): AppliedRate {
  return {
    rateId: rate.id,
    label: rate.label,
    mode: rate.mode,
    amountCents: rate.amountCents,
    surchargeBps: rate.surchargeBps,
    commissionBps: rate.commissionBps,
    fixedDeductionCents: rate.fixedDeductionCents,
    roundingStepMinutes: rate.roundingStepMinutes,
    roundingMode: rate.roundingMode,
    currency: 'EUR',
  };
}

/** Campi che influiscono sul compenso: la loro modifica su un'attività completata viene tracciata. */
export const ECONOMIC_FIELDS = [
  'date',
  'start',
  'end',
  'breakMinutes',
  'actualMinutes',
  'units',
  'status',
  'rate',
  'manualAdjustmentCents',
  'cancellationFeeCents',
  'clientId',
] as const;
