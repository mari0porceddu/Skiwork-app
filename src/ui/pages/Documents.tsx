import { useState } from 'react';
import { computeActivity } from '../../domain/compensation';
import { csvAmount, toCsv } from '../../domain/csv';
import { computeDueDate, documentBalance, documentStatus, paidForDocument } from '../../domain/documents';
import { newId } from '../../domain/ids';
import { formatEuro, sumCents } from '../../domain/money';
import { computeReminders, REMINDER_CATEGORY_LABEL } from '../../domain/reminders';
import { formatDateShort, isValidDate, nowHHmm, todayISO } from '../../domain/time';
import { DOCUMENT_STATUS_LABEL, type DocumentManualStatus, type Payment, type WorkDocument } from '../../domain/types';
import { db } from '../../db/db';
import { deleteRecord, saveRecord } from '../../db/repo';
import { EmptyState, Field, MoneyInput } from '../components/fields';
import { Sheet } from '../components/Sheet';
import { useApp } from '../context';
import { saveFile } from '../download';
import { navigate } from '../router';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function Documents() {
  const { data, openActivity } = useApp();
  const today = todayISO();
  const [editing, setEditing] = useState<WorkDocument | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const reminders = computeReminders(data, { date: today, time: nowHHmm() }, data.settings.reminders, data.settings.defaultTravelMinutes);
  const docs = data.documents
    .map((d) => ({ d, st: documentStatus(d, data.payments, today) }))
    .filter((x) => !statusFilter || x.st === statusFilter)
    .sort((a, b) => (b.d.issueDate ?? '9999').localeCompare(a.d.issueDate ?? '9999'));

  const newDoc = (): WorkDocument => ({
    id: newId(),
    clientId: data.clients[0]?.id ?? '',
    number: '',
    kind: 'Fattura',
    issueDate: null,
    periodFrom: null,
    periodTo: null,
    amountCents: 0,
    dueDate: null,
    status: 'to_prepare',
    notes: '',
    fileId: null,
    createdAt: '',
    updatedAt: '',
  });

  function exportCsv() {
    const csv = toCsv(
      ['ID', 'Tipo', 'Numero', 'Committente', 'Data emissione', 'Periodo dal', 'Periodo al', 'Importo', 'Pagato', 'Residuo', 'Scadenza', 'Stato', 'Note'],
      data.documents.map((d) => [
        d.id,
        d.kind,
        d.number,
        clients.get(d.clientId)?.name ?? '',
        d.issueDate ?? '',
        d.periodFrom ?? '',
        d.periodTo ?? '',
        csvAmount(d.amountCents),
        csvAmount(paidForDocument(d.id, data.payments)),
        csvAmount(documentBalance(d, data.payments)),
        d.dueDate ?? '',
        DOCUMENT_STATUS_LABEL[documentStatus(d, data.payments, today)],
        d.notes,
      ]),
    );
    void saveFile(`skiwork-documenti-${today}.csv`, csv, 'text/csv');
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Documenti e scadenze</h1>
        <span className="btn-group">
          <button className="btn" onClick={exportCsv}>
            CSV
          </button>
          <button className="btn primary" onClick={() => setEditing(newDoc())}>
            Nuovo documento
          </button>
        </span>
      </header>

      <section className="card">
        <h2 className="card-title">Promemoria</h2>
        {reminders.length === 0 ? (
          <p className="muted">Nessun promemoria attivo.</p>
        ) : (
          <ul className="reminders">
            {reminders.map((r) => (
              <li key={r.id} className={r.severity}>
                <button
                  className="link-block"
                  onClick={() => {
                    if (r.ref.entity === 'fiscal_deadline') navigate('fisco');
                    else if (r.ref.entity === 'activity') {
                      const a = data.activities.find((x) => x.id === r.ref.id);
                      if (a) openActivity({ activity: a });
                    } else {
                      const d = data.documents.find((x) => x.id === r.ref.id);
                      if (d) setEditing(d);
                    }
                  }}
                >
                  <span className="muted small">{REMINDER_CATEGORY_LABEL[r.category]}</span>
                  <strong>{r.title}</strong>
                  <span className="muted">{r.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">
          Registro documenti
          <select aria-label="Filtra per stato" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Tutti</option>
            {Object.entries(DOCUMENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </h2>
        {docs.length === 0 ? (
          <EmptyState title="Nessun documento">Registra fatture o altri documenti, con scadenze e pagamenti collegati. SkiWork non invia fatture elettroniche: serve come registro.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Stato</th>
                  <th className="num">Importo</th>
                  <th className="num">Residuo</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(({ d, st }) => (
                  <tr key={d.id} className="clickable" onClick={() => setEditing(d)}>
                    <td>
                      <strong>
                        {d.kind} {d.number}
                      </strong>
                      <br />
                      <small className="muted">
                        {clients.get(d.clientId)?.name} · {d.issueDate ? formatDateShort(d.issueDate) : 'non emesso'}
                        {d.dueDate ? ` · scad. ${formatDateShort(d.dueDate)}` : ''}
                      </small>
                    </td>
                    <td>
                      <span className={`badge doc-${st}`}>{DOCUMENT_STATUS_LABEL[st]}</span>
                    </td>
                    <td className="num">{formatEuro(d.amountCents)}</td>
                    <td className="num">{d.status === 'issued' ? formatEuro(documentBalance(d, data.payments)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <DocumentEditor doc={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DocumentEditor({ doc, onClose }: { doc: WorkDocument; onClose: () => void }) {
  const { data, toast, confirm } = useApp();
  const [d, setD] = useState(doc);
  const [amount, setAmount] = useState<number | null>(doc.amountCents);
  const [error, setError] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(todayISO());
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState('');
  const exists = data.documents.some((x) => x.id === doc.id);
  const payments = data.payments.filter((p) => p.documentId === doc.id).sort((a, b) => a.date.localeCompare(b.date));
  const client = data.clients.find((c) => c.id === d.clientId);
  const set = (p: Partial<WorkDocument>) => setD((x) => ({ ...x, ...p }));
  const balance = (amount ?? 0) - sumCents(payments.map((p) => p.amountCents));
  const file = data.documents.find((x) => x.id === doc.id)?.fileId ?? d.fileId;

  const periodActivities =
    d.periodFrom && d.periodTo ? data.activities.filter((a) => a.clientId === d.clientId && a.date >= d.periodFrom! && a.date <= d.periodTo! && (a.status === 'completed' || a.status === 'cancelled')) : [];
  const periodAccrued = sumCents(periodActivities.map((a) => computeActivity(a).accruedCents));

  async function save(): Promise<boolean> {
    if (!d.clientId) return setError('Seleziona il committente'), false;
    if (amount === null || amount < 0) return setError('Importo non valido'), false;
    if (d.status === 'issued' && !d.issueDate) return setError('Un documento emesso deve avere la data di emissione'), false;
    for (const k of ['issueDate', 'periodFrom', 'periodTo', 'dueDate'] as const) if (d[k] && !isValidDate(d[k]!)) return setError('Data non valida'), false;
    if (d.periodFrom && d.periodTo && d.periodTo < d.periodFrom) return setError('Periodo non valido'), false;
    await saveRecord('documents', { ...d, amountCents: amount, fileId: file });
    return true;
  }

  async function addPayment() {
    if (!exists) {
      setError('Salva prima il documento');
      return;
    }
    if (payAmount === null || payAmount <= 0) return setError('Importo del pagamento non valido');
    if (!isValidDate(payDate)) return setError('Data del pagamento non valida');
    if (!(await save())) return;
    if (payAmount > balance) {
      const c = await confirm({ title: 'Importo superiore al residuo', message: `Il pagamento supera il residuo di ${formatEuro(balance)}. Registrarlo comunque?`, confirmLabel: 'Registra' });
      if (!c.ok) return;
    }
    const p: Payment = { id: newId(), documentId: doc.id, clientId: d.clientId, date: payDate, amountCents: payAmount, method: payMethod, notes: '', createdAt: '', updatedAt: '' };
    await saveRecord('payments', p);
    setPayAmount(null);
    setError(null);
    toast('Pagamento registrato');
  }

  async function removePayment(p: Payment) {
    const c = await confirm({ title: 'Eliminare il pagamento?', message: `${formatEuro(p.amountCents)} del ${formatDateShort(p.date)}`, confirmLabel: 'Elimina', danger: true });
    if (c.ok) await deleteRecord('payments', p.id);
  }

  async function remove() {
    const c = await confirm({
      title: 'Eliminare il documento?',
      message: payments.length ? 'Verranno eliminati anche i pagamenti collegati.' : 'Il documento verrà eliminato.',
      confirmLabel: 'Elimina',
      danger: true,
    });
    if (!c.ok) return;
    for (const p of payments) await deleteRecord('payments', p.id);
    if (file) await db.files.delete(file);
    await deleteRecord('documents', d.id);
    toast('Documento eliminato');
    onClose();
  }

  async function attach(f: File) {
    if (f.size > MAX_FILE_BYTES) return setError('File troppo grande (max 10 MB)');
    if (f.type !== 'application/pdf' && !f.type.startsWith('image/')) return setError('Sono accettati PDF o immagini');
    const id = newId();
    await db.files.put({ id, name: f.name, type: f.type, size: f.size, blob: f, createdAt: new Date().toISOString() });
    if (d.fileId) await db.files.delete(d.fileId);
    set({ fileId: id });
    await saveRecord('documents', { ...d, amountCents: amount ?? 0, fileId: id });
    toast('Allegato salvato');
  }

  async function openFile() {
    if (!file) return;
    const f = await db.files.get(file);
    if (f) await saveFile(f.name, f.blob, f.type);
  }

  return (
    <Sheet
      open
      title={exists ? `${d.kind} ${d.number}`.trim() : 'Nuovo documento'}
      onClose={onClose}
      footer={
        <>
          {exists && (
            <button className="btn danger ghost" onClick={remove}>
              Elimina
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Chiudi
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              if (await save()) {
                toast('Documento salvato');
                onClose();
              }
            }}
          >
            Salva
          </button>
        </>
      }
    >
      <div className="form">
        <div className="row2">
          <Field label="Committente">
            {(id) => (
              <select id={id} value={d.clientId} onChange={(e) => set({ clientId: e.target.value })}>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Tipo documento">{(id) => <input id={id} value={d.kind} onChange={(e) => set({ kind: e.target.value })} />}</Field>
        </div>
        {client && (client.documentationMode || client.billingPeriodicity || client.adminNotes) && (
          <p className="muted small">
            {[client.documentationMode, client.billingPeriodicity && `Periodicità: ${client.billingPeriodicity}`, client.paymentTermsDays !== null && `Termine: ${client.paymentTermsDays} gg`, client.adminNotes].filter(Boolean).join(' · ')}
          </p>
        )}
        <div className="row2">
          <Field label="Periodo dal">{(id) => <input id={id} type="date" value={d.periodFrom ?? ''} onChange={(e) => set({ periodFrom: e.target.value || null })} />}</Field>
          <Field label="Periodo al">{(id) => <input id={id} type="date" value={d.periodTo ?? ''} onChange={(e) => set({ periodTo: e.target.value || null })} />}</Field>
        </div>
        {d.periodFrom && d.periodTo && (
          <p className="small">
            Maturato nel periodo per questo committente: <strong>{formatEuro(periodAccrued)}</strong> ({periodActivities.length} attività){' '}
            <button type="button" className="btn small" onClick={() => setAmount(periodAccrued)}>
              Usa come importo
            </button>
          </p>
        )}
        <div className="row2">
          <Field label="Numero">{(id) => <input id={id} value={d.number} onChange={(e) => set({ number: e.target.value })} />}</Field>
          <Field label="Importo">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
        </div>
        <div className="row2">
          <Field label="Data di emissione">
            {(id) => (
              <input
                id={id}
                type="date"
                value={d.issueDate ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null;
                  set({ issueDate: v, dueDate: d.dueDate ?? (v && client ? computeDueDate(v, client) : null) });
                }}
              />
            )}
          </Field>
          <Field label="Scadenza pagamento" hint={client?.paymentTermsDays != null ? `Calcolata con termine di ${client.paymentTermsDays} giorni` : 'Termine non configurato per il committente'}>
            {(id) => <input id={id} type="date" value={d.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />}
          </Field>
        </div>
        <Field label="Stato" hint="Pagato, parzialmente pagato e scaduto sono calcolati dai pagamenti e dalla scadenza">
          {(id) => (
            <select id={id} value={d.status} onChange={(e) => set({ status: e.target.value as DocumentManualStatus })}>
              {(['to_verify', 'to_prepare', 'to_issue', 'issued'] as DocumentManualStatus[]).map((s) => (
                <option key={s} value={s}>
                  {DOCUMENT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Note">{(id) => <textarea id={id} rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        <div className="field">
          <span className="label">Allegato (PDF o immagine, salvato solo sul dispositivo)</span>
          <div className="btn-group">
            {file && (
              <button type="button" className="btn small" onClick={openFile}>
                Apri allegato
              </button>
            )}
            {exists ? (
              <label className="btn small">
                {file ? 'Sostituisci' : 'Allega file'}
                <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
              </label>
            ) : (
              <span className="muted small">Salva il documento per aggiungere un allegato.</span>
            )}
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {exists && d.status === 'issued' && (
          <div className="card inner">
            <h3>
              Pagamenti · residuo <strong>{formatEuro(balance)}</strong>
            </h3>
            {payments.length === 0 ? (
              <p className="muted small">Nessun pagamento registrato. Un documento emesso non è un incasso.</p>
            ) : (
              <ul className="payments">
                {payments.map((p) => (
                  <li key={p.id}>
                    <span>{formatDateShort(p.date)}</span>
                    <span>{p.method}</span>
                    <strong>{formatEuro(p.amountCents)}</strong>
                    <button type="button" className="icon-btn" aria-label="Elimina pagamento" onClick={() => removePayment(p)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="row3">
              <Field label="Data incasso">{(id) => <input id={id} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />}</Field>
              <Field label="Importo">{(id) => <MoneyInput id={id} value={payAmount} onChange={setPayAmount} />}</Field>
              <Field label="Metodo">{(id) => <input id={id} value={payMethod} placeholder="Bonifico…" onChange={(e) => setPayMethod(e.target.value)} />}</Field>
            </div>
            <button type="button" className="btn primary small" onClick={addPayment}>
              Registra incasso
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
