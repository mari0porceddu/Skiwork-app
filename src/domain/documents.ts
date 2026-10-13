/** Stati dei documenti, scadenze e crediti residui. */
import { sumCents, type Cents } from './money';
import { addDays, type ISODate } from './time';
import type { Client, DocumentStatus, Payment, WorkDocument } from './types';

export function paidForDocument(docId: string, payments: Payment[]): Cents {
  return sumCents(payments.filter((p) => p.documentId === docId).map((p) => p.amountCents));
}

export function documentBalance(doc: WorkDocument, payments: Payment[]): Cents {
  return doc.amountCents - paidForDocument(doc.id, payments);
}

/**
 * Stato effettivo: gli stati manuali precedenti all'emissione restano tali;
 * per i documenti emessi lo stato deriva dai pagamenti collegati e dalla scadenza.
 */
export function documentStatus(doc: WorkDocument, payments: Payment[], today: ISODate): DocumentStatus {
  if (doc.status !== 'issued') return doc.status;
  const paid = paidForDocument(doc.id, payments);
  if (paid >= doc.amountCents) return 'paid';
  if (doc.dueDate !== null && doc.dueDate < today) return 'overdue';
  if (paid > 0) return 'partially_paid';
  return 'issued';
}

/** Scadenza = data documento + termine di pagamento del committente (se configurato). */
export function computeDueDate(issueDate: ISODate, client: Pick<Client, 'paymentTermsDays'>): ISODate | null {
  if (client.paymentTermsDays === null) return null;
  return addDays(issueDate, client.paymentTermsDays);
}

/** Documenti emessi con saldo positivo. */
export function outstandingDocuments(docs: WorkDocument[], payments: Payment[]): { doc: WorkDocument; balance: Cents }[] {
  return docs
    .filter((d) => d.status === 'issued')
    .map((doc) => ({ doc, balance: documentBalance(doc, payments) }))
    .filter((x) => x.balance > 0);
}
