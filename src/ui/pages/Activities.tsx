import { useMemo, useState } from 'react';
import { computeActivity } from '../../domain/compensation';
import { csvAmount, toCsv } from '../../domain/csv';
import { formatEuro } from '../../domain/money';
import { absInterval, addDays, dayIndex, formatMinutesAsHours, MINUTES_PER_DAY, nowHHmm, startOfMonth, timeToMinutes, todayISO } from '../../domain/time';
import { ACTIVITY_STATUS_LABEL, ACTIVITY_TYPE_LABEL, ACTIVITY_TYPES, RATE_MODE_LABEL, type Activity, type ActivityStatus } from '../../domain/types';
import { saveActivity } from '../../db/repo';
import { ActivityRow } from '../components/ActivityRow';
import { EmptyState } from '../components/fields';
import { useApp } from '../context';
import { saveFile } from '../download';
import { useRoute } from '../router';

export function activitiesCsv(rows: Activity[], clientName: (id: string | null) => string): string {
  return toCsv(
    ['ID', 'Data', 'Inizio', 'Fine', 'Tipologia', 'Committente', 'Titolo', 'Luogo', 'Stato', 'Tariffa', 'Modalità', 'Importo tariffa', 'Ore previste', 'Ore lavorate', 'Previsto €', 'Maturato €', 'Correzione €', 'Motivazione correzione', 'Note'],
    rows.map((a) => {
      const c = computeActivity(a);
      return [
        a.id,
        a.date,
        a.start,
        a.end,
        ACTIVITY_TYPE_LABEL[a.type],
        clientName(a.clientId),
        a.title,
        a.location,
        ACTIVITY_STATUS_LABEL[a.status],
        a.rate?.label ?? '',
        a.rate ? RATE_MODE_LABEL[a.rate.mode] : '',
        a.rate ? csvAmount(a.rate.amountCents) : '',
        (c.plannedMinutes / 60).toFixed(2).replace('.', ','),
        (c.workedMinutes / 60).toFixed(2).replace('.', ','),
        csvAmount(c.expectedCents),
        csvAmount(c.accruedCents),
        csvAmount(a.manualAdjustmentCents),
        a.manualAdjustmentReason,
        a.notes,
      ];
    }),
  );
}

export function Activities() {
  const { data, openActivity, toast } = useApp();
  const route = useRoute();
  const today = todayISO();
  const [from, setFrom] = useState(route.params.get('from') ?? startOfMonth(addDays(today, -60)));
  const [to, setTo] = useState(route.params.get('to') ?? addDays(today, 60));
  const [client, setClient] = useState(route.params.get('client') ?? '');
  const [type, setType] = useState('');
  const [status, setStatus] = useState(route.params.get('status') ?? '');
  const [q, setQ] = useState('');
  const clients = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const nowAbs = dayIndex(today) * MINUTES_PER_DAY + timeToMinutes(nowHHmm());

  const rows = data.activities.filter((a) => {
    if (a.date < from || a.date > to) return false;
    if (client && a.clientId !== client) return false;
    if (type && a.type !== type) return false;
    if (status === 'to_complete') {
      if (!(a.status === 'planned' || a.status === 'confirmed') || a.type === 'personal' || absInterval(a.date, a.start, a.end).end > nowAbs) return false;
    } else if (status && a.status !== status) return false;
    if (q) {
      const hay = `${a.title} ${a.location} ${a.notes} ${ACTIVITY_TYPE_LABEL[a.type]} ${a.clientId ? clients.get(a.clientId)?.name : ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const totals = rows.reduce(
    (t, a) => {
      const c = computeActivity(a);
      t.worked += c.workedMinutes;
      t.accrued += c.accruedCents;
      t.expected += c.expectedCents;
      return t;
    },
    { worked: 0, accrued: 0, expected: 0 },
  );

  async function complete(a: Activity) {
    await saveActivity({ ...a, status: 'completed' });
    toast('Attività segnata come completata');
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Attività</h1>
        <button className="btn" onClick={() => saveFile(`skiwork-attivita-${from}_${to}.csv`, activitiesCsv(rows, (id) => (id ? (clients.get(id)?.name ?? '') : '')), 'text/csv')}>
          Esporta CSV
        </button>
      </header>
      <div className="filters">
        <input type="search" placeholder="Cerca titolo, luogo, note…" aria-label="Cerca" value={q} onChange={(e) => setQ(e.target.value)} />
        <label>
          Dal <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Al <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select aria-label="Committente" value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Tutti i committenti</option>
          {data.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Tipologia" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Tutte le tipologie</option>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select aria-label="Stato" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tutti gli stati</option>
          <option value="to_complete">Da consuntivare (passate non completate)</option>
          {(Object.keys(ACTIVITY_STATUS_LABEL) as ActivityStatus[]).map((s) => (
            <option key={s} value={s}>
              {ACTIVITY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="totals-bar">
        <span>{rows.length} attività</span>
        <span>Lavorate {formatMinutesAsHours(totals.worked)}</span>
        <span>Maturato {formatEuro(totals.accrued)}</span>
        <span className="muted">Previsto {formatEuro(totals.expected)}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nessuna attività nel filtro" action={<button className="btn primary" onClick={() => openActivity()}>Aggiungi attività</button>}>
          Modifica il periodo o i filtri, oppure aggiungi una nuova attività.
        </EmptyState>
      ) : (
        <div className="list">
          {rows.map((a) => {
            const past = absInterval(a.date, a.start, a.end).end <= nowAbs;
            return (
              <div key={a.id} className="row-with-action">
                <ActivityRow a={a} client={a.clientId ? clients.get(a.clientId) : undefined} showDate onOpen={() => openActivity({ activity: a })} />
                {past && (a.status === 'planned' || a.status === 'confirmed') && a.type !== 'personal' && (
                  <button className="btn small primary" onClick={() => complete(a)}>
                    Completa
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
