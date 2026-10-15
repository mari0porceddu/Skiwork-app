import { useMemo, useState } from 'react';
import { csvAmount, toCsv } from '../../domain/csv';
import { newId } from '../../domain/ids';
import { formatEuro } from '../../domain/money';
import { buildPeriodReport, reportFilename } from '../../domain/pdfReport';
import { splitByMonth, summarize, type Metric, type Period } from '../../domain/reports';
import { addDays, endOfMonth, formatDateShort, formatMinutesAsHours, isValidDate, monthName, startOfMonth, startOfWeek, todayISO } from '../../domain/time';
import { LEDGER_KIND_LABEL, type LedgerEntry, type LedgerKind } from '../../domain/types';
import { deleteRecord, saveRecord } from '../../db/repo';
import { EmptyState, Field, MoneyInput, Segmented } from '../components/fields';
import { Sheet } from '../components/Sheet';
import { useApp } from '../context';
import { saveFile } from '../download';

type PeriodKind = 'day' | 'week' | 'month' | 'season' | 'year' | 'custom';

export function seasonFor(date: string, start: string, end: string): Period {
  // Stagione a cavallo d'anno se la fine (MM-DD) precede l'inizio.
  const y = Number(date.slice(0, 4));
  const md = date.slice(5);
  if (end >= start) return { from: `${y}-${start}`, to: `${y}-${end}` };
  if (md >= start) return { from: `${y}-${start}`, to: `${y + 1}-${end}` };
  return { from: `${y - 1}-${start}`, to: `${y}-${end}` };
}

export function Finance() {
  const { data, drill } = useApp();
  const today = todayISO();
  const [kind, setKind] = useState<PeriodKind>('month');
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState<Period>({ from: startOfMonth(today), to: today });
  const [clientId, setClientId] = useState('');
  const [editing, setEditing] = useState<LedgerEntry | null>(null);

  const period: Period = useMemo(() => {
    switch (kind) {
      case 'day':
        return { from: anchor, to: anchor };
      case 'week':
        return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 6) };
      case 'month':
        return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
      case 'season':
        return seasonFor(anchor, data.settings.seasonStart, data.settings.seasonEnd);
      case 'year':
        return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
      case 'custom':
        return custom;
    }
  }, [kind, anchor, custom, data.settings.seasonStart, data.settings.seasonEnd]);

  const s = summarize({ ...period, clientId: clientId || null }, data);
  const byClient = data.clients.map((c) => ({ c, s: summarize({ ...period, clientId: c.id }, data) })).filter((x) => x.s.workedMinutes.value > 0 || x.s.accruedCents.value !== 0 || x.s.expectedCents.value !== 0 || x.s.collectedCents.value !== 0);
  const totalAccrued = byClient.reduce((t, x) => t + Math.max(0, x.s.accruedCents.value), 0);
  const ledgerRows = data.ledger.filter((l) => l.date >= period.from && l.date <= period.to && (!clientId || l.clientId === clientId)).sort((a, b) => b.date.localeCompare(a.date));
  const clients = new Map(data.clients.map((c) => [c.id, c]));

  const d = (title: string, m: Metric, k: 'activity' | 'document' | 'payment' | 'ledger') =>
    drill({ title, activityIds: k === 'activity' ? m.ids : undefined, documentIds: k === 'document' ? m.ids : undefined, paymentIds: k === 'payment' ? m.ids : undefined, ledgerIds: k === 'ledger' ? m.ids : undefined });

  const stats: { label: string; m: Metric; k: 'activity' | 'document' | 'payment' | 'ledger'; fmt?: (v: number) => string; note?: string }[] = [
    { label: 'Ore lavorate', m: s.workedMinutes, k: 'activity', fmt: formatMinutesAsHours },
    { label: 'Compensi previsti', m: s.expectedCents, k: 'activity', note: 'non ancora maturati' },
    { label: 'Compensi maturati', m: s.accruedCents, k: 'activity' },
    { label: 'Fatturato', m: s.invoicedCents, k: 'document' },
    { label: 'Incassato', m: s.collectedCents, k: 'payment' },
    { label: 'Crediti residui', m: s.outstandingCents, k: 'document', note: `al ${formatDateShort(period.to)}` },
    { label: 'Rimborsi', m: s.reimbursementsCents, k: 'ledger', note: 'separati dai compensi' },
    { label: 'Spese', m: s.expensesCents, k: 'ledger' },
    { label: 'Accantonamenti', m: s.setAsideCents, k: 'ledger' },
  ];

  function exportCsv() {
    const rows: unknown[][] = [
      ['Periodo', `${period.from} → ${period.to}`],
      ['Committente', clientId ? clients.get(clientId)?.name : 'Tutti'],
      ...stats.map((x) => [x.label, x.fmt ? x.fmt(x.m.value) : csvAmount(x.m.value)]),
      ['Compenso medio orario', s.avgHourlyCents !== null ? csvAmount(s.avgHourlyCents) : ''],
      ['% crediti incassati', s.collectedPct ?? ''],
      [],
      ['Voci economiche'],
      ['ID', 'Data', 'Tipo', 'Committente', 'Importo', 'Descrizione'],
      ...ledgerRows.map((l) => [l.id, l.date, LEDGER_KIND_LABEL[l.kind], l.clientId ? clients.get(l.clientId)?.name : '', csvAmount(l.amountCents), l.description]),
    ];
    void saveFile(`skiwork-finanze-${period.from}_${period.to}.csv`, toCsv(['Voce', 'Valore'], rows), 'text/csv');
  }

  function exportPdf() {
    const bytes = buildPeriodReport({ period, clientId: clientId || null, data, today });
    void saveFile(reportFilename(period), new Blob([bytes as BlobPart], { type: 'application/pdf' }), 'application/pdf');
  }

  const newEntry = (k: LedgerKind): LedgerEntry => ({ id: newId(), kind: k, clientId: clientId || null, activityId: null, date: today, amountCents: 0, description: '', createdAt: '', updatedAt: '' });

  return (
    <div className="page">
      <header className="page-header">
        <h1>Finanze</h1>
        <span className="btn-group">
          <button className="btn" onClick={exportPdf}>
            Report PDF
          </button>
          <button className="btn" onClick={exportCsv}>
            CSV
          </button>
        </span>
      </header>
      <Segmented
        label="Periodo"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'day', label: 'Giorno' },
          { value: 'week', label: 'Settimana' },
          { value: 'month', label: 'Mese' },
          { value: 'season', label: 'Stagione' },
          { value: 'year', label: 'Anno' },
          { value: 'custom', label: 'Altro' },
        ]}
      />
      <div className="filters">
        {kind === 'custom' ? (
          <>
            <label>
              Dal <input type="date" value={custom.from} onChange={(e) => isValidDate(e.target.value) && setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label>
              Al <input type="date" value={custom.to} onChange={(e) => isValidDate(e.target.value) && setCustom({ ...custom, to: e.target.value })} />
            </label>
          </>
        ) : (
          <label>
            Riferimento <input type="date" value={anchor} onChange={(e) => isValidDate(e.target.value) && setAnchor(e.target.value)} />
          </label>
        )}
        <select aria-label="Committente" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Tutti i committenti</option>
          {data.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        {formatDateShort(period.from)} → {formatDateShort(period.to)}
      </p>

      <section className="card">
        <div className="stats">
          {stats.map((x) => (
            <button key={x.label} className="stat" onClick={() => d(x.label, x.m, x.k)}>
              <span className="stat-label">{x.label}</span>
              <span className="stat-value">{x.fmt ? x.fmt(x.m.value) : formatEuro(x.m.value)}</span>
              {x.note && <span className="stat-sub">{x.note}</span>}
            </button>
          ))}
          <div className="stat">
            <span className="stat-label">Compenso medio orario</span>
            <span className="stat-value">{s.avgHourlyCents !== null ? formatEuro(s.avgHourlyCents) : '—'}</span>
            <span className="stat-sub">maturato / ore lavorate</span>
          </div>
          <div className="stat">
            <span className="stat-label">Crediti incassati</span>
            <span className="stat-value">{s.collectedPct !== null ? `${s.collectedPct.toLocaleString('it-IT')}%` : '—'}</span>
            <span className="stat-sub">incassato / fatturato nel periodo</span>
          </div>
        </div>
      </section>

      {(kind === 'season' || kind === 'year' || kind === 'custom') && <MonthlyTrend period={period} clientId={clientId || null} />}

      <section className="card">
        <h2 className="card-title">Per committente</h2>
        {byClient.length === 0 ? (
          <p className="muted">Nessun dato nel periodo.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Committente</th>
                    <th className="num">Ore</th>
                    <th className="num">Maturato</th>
                    <th className="num">€/h</th>
                    <th className="num">Incassato</th>
                  </tr>
                </thead>
                <tbody>
                  {byClient.map(({ c, s: cs }) => (
                    <tr key={c.id}>
                      <th scope="row">
                        <span className="dot" style={{ background: c.color }} />
                        {c.name}
                      </th>
                      <td className="num">{formatMinutesAsHours(cs.workedMinutes.value)}</td>
                      <td className="num">{formatEuro(cs.accruedCents.value)}</td>
                      <td className="num">{cs.avgHourlyCents !== null ? formatEuro(cs.avgHourlyCents) : '—'}</td>
                      <td className="num">{formatEuro(cs.collectedCents.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalAccrued > 0 && (
              <div className="distribution" aria-label="Distribuzione dei compensi maturati">
                {byClient
                  .filter((x) => x.s.accruedCents.value > 0)
                  .map(({ c, s: cs }) => {
                    const pct = (cs.accruedCents.value / totalAccrued) * 100;
                    return (
                      <div key={c.id} style={{ width: `${pct}%`, background: c.color }} title={`${c.name}: ${pct.toFixed(1)}%`}>
                        <span>{pct >= 12 ? `${Math.round(pct)}%` : ''}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">
          Rimborsi, spese e accantonamenti
          <span className="btn-group">
            <button className="btn small" onClick={() => setEditing(newEntry('reimbursement'))}>
              + Rimborso
            </button>
            <button className="btn small" onClick={() => setEditing(newEntry('expense'))}>
              + Spesa
            </button>
            <button className="btn small" onClick={() => setEditing(newEntry('set_aside'))}>
              + Accantonamento
            </button>
          </span>
        </h2>
        {ledgerRows.length === 0 ? (
          <EmptyState title="Nessuna voce nel periodo">Registra rimborsi, spese o accantonamenti manuali. Fatture e incassi si gestiscono in Documenti.</EmptyState>
        ) : (
          <table className="table">
            <tbody>
              {ledgerRows.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => setEditing(l)}>
                  <td>{formatDateShort(l.date)}</td>
                  <td>
                    {LEDGER_KIND_LABEL[l.kind]}
                    <br />
                    <small className="muted">{[l.clientId ? clients.get(l.clientId)?.name : '', l.description].filter(Boolean).join(' · ')}</small>
                  </td>
                  <td className="num">{formatEuro(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {editing && <LedgerEditor entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LedgerEditor({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const { data, toast, confirm } = useApp();
  const [e, setE] = useState(entry);
  const [amount, setAmount] = useState<number | null>(entry.amountCents || null);
  const [error, setError] = useState<string | null>(null);
  const exists = data.ledger.some((x) => x.id === entry.id);
  const set = (p: Partial<LedgerEntry>) => setE((x) => ({ ...x, ...p }));
  const linkable = data.activities.filter((a) => a.date === e.date && (!e.clientId || a.clientId === e.clientId));

  async function save() {
    if (!isValidDate(e.date)) return setError('Data non valida');
    if (amount === null || amount === 0) return setError('Inserisci un importo diverso da zero');
    if (e.kind !== 'set_aside' && amount < 0) return setError('L’importo deve essere positivo');
    await saveRecord('ledger', { ...e, amountCents: amount });
    toast('Voce salvata');
    onClose();
  }
  async function remove() {
    const c = await confirm({ title: 'Eliminare la voce?', message: 'La voce verrà eliminata e la modifica registrata nello storico.', confirmLabel: 'Elimina', danger: true });
    if (!c.ok) return;
    await deleteRecord('ledger', e.id);
    toast('Voce eliminata');
    onClose();
  }

  return (
    <Sheet
      open
      title={LEDGER_KIND_LABEL[e.kind]}
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
            Annulla
          </button>
          <button className="btn primary" onClick={save}>
            Salva
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Tipo">
          {(id) => (
            <select id={id} value={e.kind} onChange={(ev) => set({ kind: ev.target.value as LedgerKind })}>
              {(Object.keys(LEDGER_KIND_LABEL) as LedgerKind[]).map((k) => (
                <option key={k} value={k}>
                  {LEDGER_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="row2">
          <Field label="Data">{(id) => <input id={id} type="date" value={e.date} onChange={(ev) => set({ date: ev.target.value })} />}</Field>
          <Field label="Importo" hint={e.kind === 'set_aside' ? 'Negativo per un prelievo dall’accantonamento' : undefined}>
            {(id) => <MoneyInput id={id} value={amount} onChange={setAmount} allowNegative={e.kind === 'set_aside'} />}
          </Field>
        </div>
        <Field label="Committente (facoltativo)">
          {(id) => (
            <select id={id} value={e.clientId ?? ''} onChange={(ev) => set({ clientId: ev.target.value || null })}>
              <option value="">—</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {linkable.length > 0 && (
          <Field label="Attività collegata (facoltativa)">
            {(id) => (
              <select id={id} value={e.activityId ?? ''} onChange={(ev) => set({ activityId: ev.target.value || null })}>
                <option value="">—</option>
                {linkable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.start}–{a.end} {a.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Descrizione">{(id) => <input id={id} value={e.description} onChange={(ev) => set({ description: ev.target.value })} />}</Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** Andamento mese per mese nel periodo (report mensile/stagionale). */
function MonthlyTrend({ period, clientId }: { period: Period; clientId: string | null }) {
  const { data } = useApp();
  const rows = splitByMonth(period).map((p) => ({ p, s: summarize({ ...p, clientId }, data) }));
  const max = Math.max(1, ...rows.map((r) => r.s.accruedCents.value));
  const label = (p: Period) => `${monthName(Number(p.from.slice(5, 7)) - 1).slice(0, 3)} ${p.from.slice(2, 4)}`;
  function exportCsv() {
    void saveFile(
      `skiwork-andamento-${period.from}_${period.to}.csv`,
      toCsv(
        ['Mese', 'Ore lavorate', 'Previsto', 'Maturato', 'Fatturato', 'Incassato', 'Crediti residui a fine mese'],
        rows.map(({ p, s }) => [p.from.slice(0, 7), (s.workedMinutes.value / 60).toFixed(2).replace('.', ','), csvAmount(s.expectedCents.value), csvAmount(s.accruedCents.value), csvAmount(s.invoicedCents.value), csvAmount(s.collectedCents.value), csvAmount(s.outstandingCents.value)]),
      ),
      'text/csv',
    );
  }
  return (
    <section className="card">
      <h2 className="card-title">
        Andamento mensile
        <button className="btn small" onClick={exportCsv}>
          CSV
        </button>
      </h2>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>Mese</th>
              <th className="num">Ore</th>
              <th>Maturato</th>
              <th className="num">Fatturato</th>
              <th className="num">Incassato</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => (
              <tr key={p.from}>
                <th scope="row">{label(p)}</th>
                <td className="num">{formatMinutesAsHours(s.workedMinutes.value)}</td>
                <td>
                  <div className="bar-cell">
                    <span className="bar" style={{ width: `${(Math.max(0, s.accruedCents.value) / max) * 100}%` }} />
                    <span className="num">{formatEuro(s.accruedCents.value)}</span>
                  </div>
                </td>
                <td className="num">{formatEuro(s.invoicedCents.value)}</td>
                <td className="num">{formatEuro(s.collectedCents.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
