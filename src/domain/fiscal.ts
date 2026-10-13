/**
 * Modulo fiscale parametrico, separato dal motore dei compensi.
 *
 * Non contiene aliquote, coefficienti o regole fiscali: ogni valore è un parametro
 * inserito dall'utente con anno, fonte e stato di verifica. Una STIMA viene prodotta
 * solo se tutti i parametri necessari sono "verificati" per l'anno; altrimenti si può
 * solo SIMULARE uno scenario, sempre indicato come tale.
 * Formula documentata in docs/CALCOLI.md (sezione Fisco).
 */
import { applyBps, roundHalfAwayFromZero, type Cents } from './money';
import type { ISODate } from './time';

export type FiscalParamKey =
  | 'revenue_basis'
  | 'profitability_coefficient'
  | 'substitute_tax_rate'
  | 'contribution_rate'
  | 'contribution_fixed'
  | 'deduct_contributions'
  | 'contributions_paid'
  | 'advance_rate'
  | 'advances_paid';

export type FiscalParamStatus = 'to_verify' | 'verified' | 'expired' | 'not_applicable';

export const FISCAL_PARAM_STATUS_LABEL: Record<FiscalParamStatus, string> = {
  to_verify: 'Da verificare',
  verified: 'Verificato',
  expired: 'Scaduto o da aggiornare',
  not_applicable: 'Non applicabile',
};

export type FiscalValueKind = 'percent' | 'amount' | 'boolean' | 'choice';

export interface FiscalParamDef {
  key: FiscalParamKey;
  label: string;
  kind: FiscalValueKind;
  /** Il parametro può avere un valore diverso per committente (es. trattamento previdenziale). */
  perClient: boolean;
  /** Necessario per produrre una stima. */
  required: boolean;
  help: string;
}

export const FISCAL_PARAM_DEFS: FiscalParamDef[] = [
  { key: 'revenue_basis', label: 'Base dei ricavi', kind: 'choice', perClient: false, required: true, help: 'Quali importi considerare come ricavi dell’anno: incassati (cassa) o fatturati.' },
  { key: 'profitability_coefficient', label: 'Coefficiente di redditività', kind: 'percent', perClient: false, required: true, help: 'Percentuale dei ricavi considerata reddito.' },
  { key: 'contribution_rate', label: 'Aliquota contributiva', kind: 'percent', perClient: true, required: true, help: 'Per committente: il trattamento previdenziale può essere diverso. Se non si applica, segna “Non applicabile” con la motivazione.' },
  { key: 'contribution_fixed', label: 'Contributi fissi annui', kind: 'amount', perClient: false, required: false, help: 'Eventuale quota fissa annua, se prevista dalla tua gestione.' },
  { key: 'deduct_contributions', label: 'Contributi deducibili dal reddito', kind: 'boolean', perClient: false, required: true, help: 'Se i contributi versati nell’anno si sottraggono dal reddito imponibile.' },
  { key: 'contributions_paid', label: 'Contributi versati nell’anno', kind: 'amount', perClient: false, required: false, help: 'Importo effettivamente versato nell’anno, usato per la deduzione.' },
  { key: 'substitute_tax_rate', label: 'Aliquota imposta sostitutiva', kind: 'percent', perClient: false, required: true, help: 'Aliquota applicata al reddito imponibile.' },
  { key: 'advance_rate', label: 'Acconti sull’anno successivo', kind: 'percent', perClient: false, required: false, help: 'Percentuale dell’imposta dovuta come acconti per l’anno successivo.' },
  { key: 'advances_paid', label: 'Acconti già versati per l’anno', kind: 'amount', perClient: false, required: false, help: 'Acconti versati in corso d’anno, sottratti dal saldo.' },
];

export interface FiscalParam {
  id: string;
  key: FiscalParamKey;
  /** Anno fiscale di riferimento. */
  year: number;
  /** null = tutti i committenti. */
  clientId: string | null;
  /** percent: punti base; amount: centesimi; boolean: 0/1; choice: stringa. null se non inserito. */
  value: number | string | null;
  status: FiscalParamStatus;
  /** Motivazione (obbligatoria per "non applicabile"). */
  statusReason: string;
  /** Fonte o documento di riferimento (es. "email commercialista 12/10"). */
  source: string;
  validFrom: ISODate | null;
  validTo: ISODate | null;
  lastVerifiedAt: ISODate | null;
  createdAt: string;
  updatedAt: string;
}

export interface FiscalInputs {
  year: number;
  /** Incassi dell'anno per committente (centesimi). */
  collectedByClient: Map<string, Cents>;
  /** Fatturato dell'anno per committente (centesimi). */
  invoicedByClient: Map<string, Cents>;
  /** Spese dell'anno (solo per la liquidità stimata, non deducibili nella formula). */
  expensesCents: Cents;
  /** Accantonato finora. */
  setAsideCents: Cents;
}

/** Valori usati da un calcolo: dai parametri (stima) o da uno scenario (simulazione). */
export interface FiscalValues {
  revenueBasis: 'collected' | 'invoiced';
  profitabilityBps: number;
  substituteTaxBps: number;
  /** Aliquota contributiva per committente; null = non applicabile. */
  contributionBpsByClient: Map<string, number | null>;
  contributionFixedCents: Cents;
  deductContributions: boolean;
  contributionsPaidCents: Cents;
  advanceBps: number;
  advancesPaidCents: Cents;
}

export interface FiscalStep {
  label: string;
  formula: string;
  cents: Cents;
}

export interface FiscalResult {
  revenueInvoicedCents: Cents;
  revenueCollectedCents: Cents;
  revenueBaseCents: Cents;
  taxableIncomeCents: Cents;
  contributionsCents: Cents;
  substituteTaxCents: Cents;
  advancesNextYearCents: Cents;
  balanceDueCents: Cents;
  suggestedSetAsideCents: Cents;
  setAsideGapCents: Cents;
  residualLiquidityCents: Cents;
  steps: FiscalStep[];
}

export interface MissingParam {
  key: FiscalParamKey;
  clientId: string | null;
  reason: 'missing' | 'not_verified' | 'expired' | 'no_value' | 'no_reason';
}

/** Parametro valido per anno, committente e data (preferisce quello specifico del committente). */
export function findParam(params: FiscalParam[], key: FiscalParamKey, year: number, clientId: string | null, onDate?: ISODate): FiscalParam | null {
  const ok = params.filter(
    (p) =>
      p.key === key &&
      p.year === year &&
      (p.clientId === clientId || p.clientId === null) &&
      (!onDate || ((p.validFrom === null || p.validFrom <= onDate) && (p.validTo === null || onDate <= p.validTo))),
  );
  ok.sort((a, b) => Number(b.clientId !== null) - Number(a.clientId !== null) || b.updatedAt.localeCompare(a.updatedAt));
  return ok[0] ?? null;
}

const sumMap = (m: Map<string, Cents>) => [...m.values()].reduce((s, v) => s + v, 0);

/**
 * Verifica se i parametri permettono una stima. Restituisce i valori oppure l'elenco
 * dei parametri mancanti o non verificati. I committenti considerati sono quelli con ricavi nell'anno.
 */
export function resolveVerifiedValues(params: FiscalParam[], inputs: FiscalInputs, clientIds: string[]): { values: FiscalValues | null; missing: MissingParam[] } {
  const missing: MissingParam[] = [];
  const get = (key: FiscalParamKey, clientId: string | null): FiscalParam | null => {
    const def = FISCAL_PARAM_DEFS.find((d) => d.key === key)!;
    const p = findParam(params, key, inputs.year, clientId);
    if (!p) {
      if (def.required) missing.push({ key, clientId, reason: 'missing' });
      return null;
    }
    if (p.status === 'not_applicable') {
      if (p.statusReason.trim() === '') missing.push({ key, clientId, reason: 'no_reason' });
      return p;
    }
    if (p.status === 'expired') {
      missing.push({ key, clientId, reason: 'expired' });
      return null;
    }
    if (p.status !== 'verified') {
      if (def.required || p.value !== null) missing.push({ key, clientId, reason: 'not_verified' });
      return null;
    }
    if (p.value === null || p.value === '') {
      missing.push({ key, clientId, reason: 'no_value' });
      return null;
    }
    return p;
  };
  const num = (p: FiscalParam | null) => (p && p.status !== 'not_applicable' && typeof p.value === 'number' ? p.value : 0);

  const basis = get('revenue_basis', null);
  const coef = get('profitability_coefficient', null);
  const tax = get('substitute_tax_rate', null);
  const deduct = get('deduct_contributions', null);
  const fixed = get('contribution_fixed', null);
  const paid = get('contributions_paid', null);
  const adv = get('advance_rate', null);
  const advPaid = get('advances_paid', null);
  const contrib = new Map<string, number | null>();
  for (const c of clientIds) {
    const p = get('contribution_rate', c);
    contrib.set(c, p && p.status === 'not_applicable' ? null : num(p));
  }
  if (missing.length > 0) return { values: null, missing };
  return {
    values: {
      revenueBasis: basis?.value === 'invoiced' ? 'invoiced' : 'collected',
      profitabilityBps: num(coef),
      substituteTaxBps: num(tax),
      contributionBpsByClient: contrib,
      contributionFixedCents: num(fixed),
      deductContributions: num(deduct) === 1,
      contributionsPaidCents: num(paid),
      advanceBps: num(adv),
      advancesPaidCents: num(advPaid),
    },
    missing: [],
  };
}

/** Calcolo deterministico con passaggi espliciti. Usato sia per la stima sia per la simulazione. */
export function computeFiscal(inputs: FiscalInputs, v: FiscalValues, clientName: (id: string) => string = (id) => id): FiscalResult {
  const steps: FiscalStep[] = [];
  const invoiced = sumMap(inputs.invoicedByClient);
  const collected = sumMap(inputs.collectedByClient);
  const byClient = v.revenueBasis === 'collected' ? inputs.collectedByClient : inputs.invoicedByClient;
  const base = v.revenueBasis === 'collected' ? collected : invoiced;
  steps.push({ label: `Ricavi considerati (${v.revenueBasis === 'collected' ? 'incassati' : 'fatturati'})`, formula: 'somma per committente', cents: base });

  const pct = (bps: number) => `${(bps / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`;
  const grossIncome = applyBps(base, v.profitabilityBps);
  steps.push({ label: 'Reddito lordo', formula: `ricavi × ${pct(v.profitabilityBps)}`, cents: grossIncome });

  // Contributi: reddito lordo attribuito a ciascun committente in proporzione ai ricavi × aliquota del committente.
  let contributions = 0;
  for (const [clientId, revenue] of byClient) {
    const rate = v.contributionBpsByClient.get(clientId);
    if (rate === null || rate === undefined || revenue === 0) continue;
    const share = base > 0 ? roundHalfAwayFromZero((grossIncome * revenue) / base) : 0;
    const c = applyBps(share, rate);
    contributions += c;
    steps.push({ label: `Contributi ${clientName(clientId)}`, formula: `quota reddito ${(share / 100).toFixed(2)} € × ${pct(rate)}`, cents: c });
  }
  if (v.contributionFixedCents) {
    contributions += v.contributionFixedCents;
    steps.push({ label: 'Contributi fissi', formula: 'parametro', cents: v.contributionFixedCents });
  }

  const deduction = v.deductContributions ? Math.min(v.contributionsPaidCents, grossIncome) : 0;
  if (v.deductContributions) steps.push({ label: 'Contributi versati dedotti', formula: 'min(versati, reddito lordo)', cents: -deduction });
  const taxable = Math.max(0, grossIncome - deduction);
  steps.push({ label: 'Reddito imponibile stimato', formula: v.deductContributions ? 'reddito lordo − contributi dedotti' : 'reddito lordo', cents: taxable });

  const tax = applyBps(taxable, v.substituteTaxBps);
  steps.push({ label: 'Imposta sostitutiva', formula: `imponibile × ${pct(v.substituteTaxBps)}`, cents: tax });
  const balance = tax - v.advancesPaidCents;
  steps.push({ label: 'Saldo imposta', formula: 'imposta − acconti versati', cents: balance });
  const advances = applyBps(tax, v.advanceBps);
  steps.push({ label: 'Acconti per l’anno successivo', formula: `imposta × ${pct(v.advanceBps)}`, cents: advances });

  const suggested = Math.max(0, balance) + advances + contributions;
  steps.push({ label: 'Accantonamento suggerito', formula: 'saldo + acconti + contributi', cents: suggested });
  const gap = suggested - inputs.setAsideCents;
  const liquidity = collected - inputs.expensesCents - suggested;
  steps.push({ label: 'Liquidità residua stimata', formula: 'incassato − spese − accantonamento suggerito', cents: liquidity });

  return {
    revenueInvoicedCents: invoiced,
    revenueCollectedCents: collected,
    revenueBaseCents: base,
    taxableIncomeCents: taxable,
    contributionsCents: contributions,
    substituteTaxCents: tax,
    advancesNextYearCents: advances,
    balanceDueCents: balance,
    suggestedSetAsideCents: suggested,
    setAsideGapCents: gap,
    residualLiquidityCents: liquidity,
    steps,
  };
}

export const FISCAL_PARAM_KEYS = FISCAL_PARAM_DEFS.map((d) => d.key);

export interface FiscalDeadline {
  id: string;
  date: ISODate;
  title: string;
  /** Importo previsto, se noto. */
  amountCents: Cents | null;
  notes: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}
