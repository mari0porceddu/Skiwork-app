import { describe, expect, it } from 'vitest';
import { computeFiscal, resolveVerifiedValues, type FiscalInputs, type FiscalParam, type FiscalValues } from '../src/domain/fiscal';

const T = '2026-01-01T00:00:00Z';
function p(over: Partial<FiscalParam>): FiscalParam {
  return { id: Math.random().toString(), key: 'profitability_coefficient', year: 2026, clientId: null, value: null, status: 'verified', statusReason: '', source: 'test', validFrom: null, validTo: null, lastVerifiedAt: '2026-01-01', createdAt: T, updatedAt: T, ...over };
}
const inputs: FiscalInputs = {
  year: 2026,
  collectedByClient: new Map([
    ['school', 1_000_000],
    ['asd', 500_000],
  ]),
  invoicedByClient: new Map([
    ['school', 1_200_000],
    ['asd', 500_000],
  ]),
  expensesCents: 50_000,
  setAsideCents: 100_000,
};
// Valori di prova arbitrari, NON regole fiscali reali.
const complete = [
  p({ key: 'revenue_basis', value: 'collected' }),
  p({ key: 'profitability_coefficient', value: 5000 }),
  p({ key: 'substitute_tax_rate', value: 1000 }),
  p({ key: 'deduct_contributions', value: 1 }),
  p({ key: 'contributions_paid', value: 20_000 }),
  p({ key: 'contribution_rate', clientId: 'school', value: 2000 }),
  p({ key: 'contribution_rate', clientId: 'asd', status: 'not_applicable', statusReason: 'Da verificare: esempio di test' }),
];

describe('modulo fiscale', () => {
  it('senza parametri non produce stime', () => {
    const r = resolveVerifiedValues([], inputs, ['school', 'asd']);
    expect(r.values).toBeNull();
    expect(r.missing.map((m) => m.key)).toContain('substitute_tax_rate');
    expect(r.missing.filter((m) => m.key === 'contribution_rate').map((m) => m.clientId)).toEqual(['school', 'asd']);
  });

  it('i parametri non verificati non generano stime presentate come definitive', () => {
    const params = complete.map((x) => (x.key === 'substitute_tax_rate' ? { ...x, status: 'to_verify' as const } : x));
    const r = resolveVerifiedValues(params, inputs, ['school', 'asd']);
    expect(r.values).toBeNull();
    expect(r.missing).toEqual([{ key: 'substitute_tax_rate', clientId: null, reason: 'not_verified' }]);
  });

  it('i parametri scaduti e "non applicabile" senza motivazione bloccano la stima', () => {
    const exp = complete.map((x) => (x.key === 'profitability_coefficient' ? { ...x, status: 'expired' as const } : x));
    expect(resolveVerifiedValues(exp, inputs, ['school', 'asd']).missing[0]?.reason).toBe('expired');
    const noReason = complete.map((x) => (x.clientId === 'asd' ? { ...x, statusReason: '' } : x));
    expect(resolveVerifiedValues(noReason, inputs, ['school', 'asd']).missing[0]?.reason).toBe('no_reason');
  });

  it('i parametri di un altro anno non valgono', () => {
    const r = resolveVerifiedValues(complete.map((x) => ({ ...x, year: 2025 })), inputs, ['school']);
    expect(r.values).toBeNull();
  });

  it('con parametri verificati calcola e mostra ogni passaggio', () => {
    const r = resolveVerifiedValues(complete, inputs, ['school', 'asd']);
    expect(r.missing).toEqual([]);
    const f = computeFiscal(inputs, r.values!);
    // ricavi incassati 15.000; reddito lordo 50% = 7.500
    expect(f.revenueBaseCents).toBe(1_500_000);
    // contributi solo scuola: quota reddito 7.500 × 10.000/15.000 = 5.000 × 20% = 1.000
    expect(f.contributionsCents).toBe(100_000);
    // imponibile 7.500 − 200 = 7.300; imposta 10% = 730
    expect(f.taxableIncomeCents).toBe(730_000);
    expect(f.substituteTaxCents).toBe(73_000);
    expect(f.suggestedSetAsideCents).toBe(173_000);
    expect(f.residualLiquidityCents).toBe(1_500_000 - 50_000 - 173_000);
    expect(f.steps.map((s) => s.label)).toContain('Imposta sostitutiva');
    expect(f.revenueInvoicedCents).toBe(1_700_000);
  });

  it('distingue incassi e fatturato come base dei ricavi', () => {
    const v: FiscalValues = { revenueBasis: 'invoiced', profitabilityBps: 10000, substituteTaxBps: 0, contributionBpsByClient: new Map(), contributionFixedCents: 0, deductContributions: false, contributionsPaidCents: 0, advanceBps: 0, advancesPaidCents: 0 };
    expect(computeFiscal(inputs, v).taxableIncomeCents).toBe(1_700_000);
    expect(computeFiscal(inputs, { ...v, revenueBasis: 'collected' }).taxableIncomeCents).toBe(1_500_000);
  });

  it('il parametro specifico del committente prevale su quello generale', () => {
    const params = [...complete.filter((x) => x.key !== 'contribution_rate'), p({ key: 'contribution_rate', value: 1000 }), p({ key: 'contribution_rate', clientId: 'asd', value: 0 })];
    const r = resolveVerifiedValues(params, inputs, ['school', 'asd']);
    expect(r.values!.contributionBpsByClient.get('school')).toBe(1000);
    expect(r.values!.contributionBpsByClient.get('asd')).toBe(0);
  });
});
