import { computeFiscal, resolveVerifiedValues, type FiscalInputs, type FiscalResult, type MissingParam } from '../domain/fiscal';
import type { AppData } from './data';

export function fiscalInputs(data: AppData, year: number): FiscalInputs {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const collected = new Map<string, number>();
  const invoiced = new Map<string, number>();
  for (const p of data.payments) if (p.date >= from && p.date <= to) collected.set(p.clientId, (collected.get(p.clientId) ?? 0) + p.amountCents);
  for (const d of data.documents)
    if (d.status === 'issued' && d.issueDate && d.issueDate >= from && d.issueDate <= to) invoiced.set(d.clientId, (invoiced.get(d.clientId) ?? 0) + d.amountCents);
  const expenses = data.ledger.filter((l) => l.kind === 'expense' && l.date >= from && l.date <= to).reduce((s, l) => s + l.amountCents, 0);
  const setAside = data.ledger.filter((l) => l.kind === 'set_aside' && l.date <= to).reduce((s, l) => s + l.amountCents, 0);
  return { year, collectedByClient: collected, invoicedByClient: invoiced, expensesCents: expenses, setAsideCents: setAside };
}

/** Committenti rilevanti per l'anno: con ricavi, oppure attivi. */
export function fiscalClientIds(data: AppData, inputs: FiscalInputs): string[] {
  const ids = new Set<string>([...inputs.collectedByClient.keys(), ...inputs.invoicedByClient.keys()]);
  for (const c of data.clients) if (c.active) ids.add(c.id);
  return [...ids];
}

export function fiscalEstimate(data: AppData, year: number): { inputs: FiscalInputs; result: FiscalResult | null; missing: MissingParam[] } {
  const inputs = fiscalInputs(data, year);
  const { values, missing } = resolveVerifiedValues(data.fiscalParams, inputs, fiscalClientIds(data, inputs));
  const names = new Map(data.clients.map((c) => [c.id, c.name]));
  return { inputs, missing, result: values ? computeFiscal(inputs, values, (id) => names.get(id) ?? id) : null };
}
