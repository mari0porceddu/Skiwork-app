import { documentBalance, documentStatus } from '../domain/documents';
import { formatEuro } from '../domain/money';
import { formatDateShort, todayISO } from '../domain/time';
import { DOCUMENT_STATUS_LABEL, LEDGER_KIND_LABEL } from '../domain/types';
import { ActivityRow } from './components/ActivityRow';
import { EmptyState } from './components/fields';
import { Sheet } from './components/Sheet';
import { useApp, type DrillSpec } from './context';

/** Mostra le registrazioni che compongono un indicatore. */
export function DrillSheet({ spec, onClose }: { spec: DrillSpec; onClose: () => void }) {
  const { data, openActivity } = useApp();
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const acts = data.activities.filter((a) => spec.activityIds?.includes(a.id));
  const docs = data.documents.filter((d) => spec.documentIds?.includes(d.id));
  const pays = data.payments.filter((p) => spec.paymentIds?.includes(p.id));
  const ledger = data.ledger.filter((l) => spec.ledgerIds?.includes(l.id));
  const total = acts.length + docs.length + pays.length + ledger.length;
  const today = todayISO();
  return (
    <Sheet open title={spec.title} onClose={onClose}>
      {total === 0 && <EmptyState title="Nessuna registrazione">Questo valore è zero nel periodo selezionato.</EmptyState>}
      {acts.length > 0 && (
        <div className="list">
          {acts.map((a) => (
            <ActivityRow
              key={a.id}
              a={a}
              client={a.clientId ? clients.get(a.clientId) : undefined}
              showDate
              onOpen={() => {
                onClose();
                openActivity({ activity: a });
              }}
            />
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Committente</th>
              <th>Stato</th>
              <th className="num">Residuo</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.kind} {d.number}
                  <br />
                  <small className="muted">{d.issueDate ? formatDateShort(d.issueDate) : '—'}</small>
                </td>
                <td>{clients.get(d.clientId)?.name}</td>
                <td>{DOCUMENT_STATUS_LABEL[documentStatus(d, data.payments, today)]}</td>
                <td className="num">{formatEuro(documentBalance(d, data.payments))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pays.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Committente</th>
              <th className="num">Importo</th>
            </tr>
          </thead>
          <tbody>
            {pays.map((p) => (
              <tr key={p.id}>
                <td>{formatDateShort(p.date)}</td>
                <td>{clients.get(p.clientId)?.name}</td>
                <td className="num">{formatEuro(p.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ledger.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Voce</th>
              <th className="num">Importo</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id}>
                <td>{formatDateShort(l.date)}</td>
                <td>
                  {LEDGER_KIND_LABEL[l.kind]}
                  {l.description ? ` · ${l.description}` : ''}
                </td>
                <td className="num">{formatEuro(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Sheet>
  );
}
