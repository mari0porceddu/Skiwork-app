import { useMemo, useState } from 'react';
import { backupNudge } from '../../domain/backupNudge';
import { backupRecords, createBackupFile, isIosBrowserTab } from '../backupActions';
import { driveAvailable, driveToken, startDriveAuth } from '../../sync/drive';
import { syncToDrive } from '../../sync/driveSync';
import { needsPush } from '../../domain/gcal';
import { goalCurrentValue, goalProgress } from '../../domain/goals';
import { applyBps, formatBps, formatEuro, sumCents } from '../../domain/money';
import { computeReminders } from '../../domain/reminders';
import { summarize, type Metric } from '../../domain/reports';
import { absInterval, addDays, dayIndex, endOfMonth, formatDateLong, formatMinutesAsHours, MINUTES_PER_DAY, minutesToTime, nowHHmm, startOfMonth, startOfWeek, timeToMinutes, todayISO } from '../../domain/time';
import { computeDayAvailability, formatInterval } from '../../domain/schedule';
import { ACTIVITY_TYPE_LABEL } from '../../domain/types';
import { ActivityRow } from '../components/ActivityRow';
import { EmptyState } from '../components/fields';
import { useApp } from '../context';
import { href } from '../router';
import { GoalBar } from './Goals';

import { FISCAL_NOT_CONFIGURED } from './Fiscal';
import { fiscalEstimate } from '../fiscalData';

function Stat({ label, value, metric, onDrill, sub }: { label: string; value: string; metric?: Metric; onDrill?: (title: string, m: Metric) => void; sub?: string }) {
  const clickable = metric && onDrill;
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  );
  return clickable ? (
    <button type="button" className="stat" onClick={() => onDrill(label, metric)}>
      {content}
    </button>
  ) : (
    <div className="stat">{content}</div>
  );
}

export function Dashboard() {
  const { data, openActivity, drill } = useApp();
  const today = todayISO();
  const now = nowHHmm();
  const clients = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const nowAbs = dayIndex(today) * MINUTES_PER_DAY + timeToMinutes(now);

  const upcoming = data.activities.filter((a) => a.status !== 'cancelled' && a.status !== 'completed' && absInterval(a.date, a.start, a.end).end > nowAbs);
  const next = upcoming[0];
  const todayList = data.activities.filter((a) => a.date === today);

  const week = { from: startOfWeek(today), to: addDays(startOfWeek(today), 6) };
  const month = { from: startOfMonth(today), to: endOfMonth(today) };
  const weekSum = summarize(week, data);
  const monthByClient = data.clients
    .filter((c) => c.active || data.activities.some((a) => a.clientId === c.id && a.date >= month.from && a.date <= month.to))
    .map((c) => ({ client: c, s: summarize({ ...month, clientId: c.id }, data) }));
  const monthTotal = summarize(month, data);

  const drillMetric = (title: string, m: Metric, kind: 'activity' | 'document' | 'payment' | 'ledger' = 'activity') =>
    drill({ title, activityIds: kind === 'activity' ? m.ids : undefined, documentIds: kind === 'document' ? m.ids : undefined, paymentIds: kind === 'payment' ? m.ids : undefined, ledgerIds: kind === 'ledger' ? m.ids : undefined });

  const reminders = computeReminders(data, { date: today, time: now }, data.settings.reminders, data.settings.defaultTravelMinutes);

  const setAsideAll = data.ledger.filter((l) => l.kind === 'set_aside' && l.date <= today);
  const setAsideTotal = sumCents(setAsideAll.map((l) => l.amountCents));
  const yearCollected = summarize({ from: `${today.slice(0, 4)}-01-01`, to: today }, data).collectedCents;

  const slots = [today, addDays(today, 1)].map((d) => ({
    date: d,
    av: computeDayAvailability(d, data.availability, data.activities, { clients, defaultTravel: data.settings.defaultTravelMinutes, minSlotMinutes: data.settings.minSlotMinutes }),
  }));

  const asdIds = new Set(data.clients.filter((c) => c.kind === 'asd').map((c) => c.id));
  const weekAsd = data.clients.filter((c) => asdIds.has(c.id)).map((c) => summarize({ ...week, clientId: c.id }, data).workedMinutes);
  const weekAsdMetric: Metric = { value: weekAsd.reduce((s, m) => s + m.value, 0), ids: weekAsd.flatMap((m) => m.ids) };

  const fiscal = fiscalEstimate(data, Number(today.slice(0, 4)));
  const activeGoals = data.goals.filter((g) => g.periodFrom <= today && g.periodTo >= today).slice(0, 3);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="muted cap">{formatDateLong(today)}</p>
          <h1>Dashboard</h1>
        </div>
      </header>

      <BackupBanner />
      <CalendarCards />

      <section className="card highlight">
        <h2 className="card-title">Prossimo impegno</h2>
        {next ? (
          <ActivityRow a={next} client={next.clientId ? clients.get(next.clientId) : undefined} showDate={next.date !== today} onOpen={() => openActivity({ activity: next })} />
        ) : (
          <EmptyState title="Nessun impegno in programma" action={<button className="btn primary" onClick={() => openActivity()}>Aggiungi attività</button>} />
        )}
      </section>

      <section className="card">
        <h2 className="card-title">
          Oggi <a className="link" href={href('calendario', { view: 'day', date: today })}>Calendario</a>
        </h2>
        {todayList.length === 0 ? (
          <p className="muted">Nessuna attività registrata oggi.</p>
        ) : (
          <div className="list">
            {todayList.map((a) => (
              <ActivityRow key={a.id} a={a} client={a.clientId ? clients.get(a.clientId) : undefined} onOpen={() => openActivity({ activity: a })} />
            ))}
          </div>
        )}
      </section>

      {reminders.length > 0 && (
        <section className="card">
          <h2 className="card-title">
            Da fare <a className="link" href={href('documenti')}>Tutti ({reminders.length})</a>
          </h2>
          <ul className="reminders">
            {reminders.slice(0, 4).map((r) => (
              <li key={r.id} className={r.severity}>
                <strong>{r.title}</strong>
                <span className="muted">{r.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Questa settimana</h2>
        <div className="stats">
          <Stat label="Ore lavorate" value={formatMinutesAsHours(weekSum.workedMinutes.value)} metric={weekSum.workedMinutes} onDrill={drillMetric} sub={`+ ${formatMinutesAsHours(weekSum.plannedMinutes.value)} in programma`} />
          <Stat label={`Ore ${ACTIVITY_TYPE_LABEL.private_lesson.toLowerCase()}`} value={formatMinutesAsHours(weekSum.privateLessonMinutes.value)} metric={weekSum.privateLessonMinutes} onDrill={drillMetric} />
          <Stat label="Ore ASD" value={formatMinutesAsHours(weekAsdMetric.value)} metric={weekAsdMetric} onDrill={drillMetric} />
          <Stat label="Maturato" value={formatEuro(weekSum.accruedCents.value)} metric={weekSum.accruedCents} onDrill={drillMetric} />
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">
          Questo mese <a className="link" href={href('finanze')}>Finanze</a>
        </h2>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th></th>
                <th className="num">Previsto</th>
                <th className="num">Maturato</th>
                <th className="num">Fatturato</th>
                <th className="num">Incassato</th>
                <th className="num">Da incassare</th>
              </tr>
            </thead>
            <tbody>
              {[...monthByClient.map((x) => ({ name: x.client.name, color: x.client.color, s: x.s })), { name: 'Totale', color: '', s: monthTotal }].map((row) => (
                <tr key={row.name} className={row.name === 'Totale' ? 'total' : ''}>
                  <th scope="row">
                    {row.color && <span className="dot" style={{ background: row.color }} />}
                    {row.name}
                  </th>
                  <td className="num">
                    <button className="cell-btn muted" onClick={() => drillMetric(`Previsto · ${row.name}`, row.s.expectedCents)}>{formatEuro(row.s.expectedCents.value)}</button>
                  </td>
                  <td className="num">
                    <button className="cell-btn" onClick={() => drillMetric(`Maturato · ${row.name}`, row.s.accruedCents)}>{formatEuro(row.s.accruedCents.value)}</button>
                  </td>
                  <td className="num">
                    <button className="cell-btn" onClick={() => drillMetric(`Fatturato · ${row.name}`, row.s.invoicedCents, 'document')}>{formatEuro(row.s.invoicedCents.value)}</button>
                  </td>
                  <td className="num">
                    <button className="cell-btn" onClick={() => drillMetric(`Incassato · ${row.name}`, row.s.collectedCents, 'payment')}>{formatEuro(row.s.collectedCents.value)}</button>
                  </td>
                  <td className="num">
                    <button className="cell-btn" onClick={() => drillMetric(`Crediti residui · ${row.name}`, row.s.outstandingCents, 'document')}>{formatEuro(row.s.outstandingCents.value)}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Previsto = attività pianificate o confermate. Maturato = attività completate. Il fatturato non è liquidità: conta solo l’incassato.</p>
      </section>

      <section className="card">
        <h2 className="card-title">Accantonamenti e fisco</h2>
        <div className="stats">
          <Stat label="Accantonato" value={formatEuro(setAsideTotal)} metric={{ value: setAsideTotal, ids: setAsideAll.map((l) => l.id) }} onDrill={(t, m) => drillMetric(t, m, 'ledger')} />
          {data.settings.manualSetAsideBps !== null && (
            <Stat
              label="Accantonamento prudenziale (scelta manuale)"
              value={formatEuro(applyBps(yearCollected.value, data.settings.manualSetAsideBps))}
              sub={`${formatBps(data.settings.manualSetAsideBps)} dell’incassato ${today.slice(0, 4)} (${formatEuro(yearCollected.value)}) — non è un calcolo fiscale`}
            />
          )}
        </div>
        {fiscal.result ? (
          <div className="stats">
            <Stat label="Accantonamento fiscale stimato" value={formatEuro(fiscal.result.suggestedSetAsideCents)} sub={`Stima ${today.slice(0, 4)} con parametri verificati · ancora da accantonare ${formatEuro(fiscal.result.setAsideGapCents)}`} />
          </div>
        ) : (
          <p className="alert info">
            {FISCAL_NOT_CONFIGURED} <a href={href('fisco')}>Parametri</a>
          </p>
        )}
      </section>

      {activeGoals.length > 0 && (
        <section className="card">
          <h2 className="card-title">
            Obiettivi <a className="link" href={href('obiettivi')}>Tutti</a>
          </h2>
          {activeGoals.map((g) => (
            <GoalBar key={g.id} goal={g} progress={goalProgress(g, goalCurrentValue(g, data.activities, data.payments, today), today)} compact />
          ))}
        </section>
      )}

      <section className="card">
        <h2 className="card-title">
          Slot liberi <a className="link" href={href('calendario', { view: 'availability', date: today })}>Disponibilità</a>
        </h2>
        {slots.map(({ date, av }) => (
          <div key={date} className="slot-day">
            <strong>{date === today ? 'Oggi' : 'Domani'}</strong>{' '}
            {av.noRules ? (
              <span className="muted">nessuna disponibilità configurata</span>
            ) : av.freeSlots.length === 0 ? (
              <span className="muted">nessuno slot libero</span>
            ) : (
              av.freeSlots.map((s) => (
                <button key={s.start} className="chip" onClick={() => openActivity({ date, start: minutesToTime(s.start), end: minutesToTime(Math.min(s.end, s.start + 60)) })}>
                  {formatInterval(s)}
                </button>
              ))
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

/** Avvisi per non perdere i dati: app non installata su iPhone e backup da fare. */
function BackupBanner() {
  const { data, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const records = backupRecords(data);
  const n = backupNudge(data.settings.lastBackupAt, records, new Date());
  const notInstalled = isIosBrowserTab();
  const useDrive = data.settings.driveSync && driveAvailable();
  if (!n.show && !notInstalled) return null;
  return (
    <section className="card">
      {notInstalled && (
        <p className="alert warning">
          Stai usando SkiWork dentro Safari: qui iOS può cancellare i dati dopo alcuni giorni senza uso. Installala con Condividi → <strong>Aggiungi alla schermata Home</strong> e aprila sempre dall’icona.
        </p>
      )}
      {n.show && (
        <>
          <p className="alert warning">
            {n.days === null ? 'Non hai ancora fatto un backup.' : `Ultimo backup ${n.days === 0 ? 'oggi' : n.days === 1 ? 'ieri' : `${n.days} giorni fa`}, da allora ${n.changes} modifiche.`} {useDrive ? (driveToken() ? 'Ci sono modifiche non ancora salvate su Google Drive.' : 'Per continuare a salvare su Google Drive tocca Riconnetti (l’accesso Google scade dopo un’ora).') : 'I dati sono solo su questo telefono: salva una copia su iCloud Drive (Salva su File).'}
          </p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (useDrive) {
                  const token = driveToken();
                  if (!token) return startDriveAuth('reconnect');
                  await syncToDrive(token, data.settings.driveLastSyncAt === null);
                  toast('Salvato su Google Drive');
                } else {
                  await createBackupFile();
                  toast('Backup creato');
                }
              } catch (e) {
                toast(`Salvataggio non riuscito: ${(e as Error).message}`, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {useDrive ? (driveToken() ? 'Salva su Google Drive ora' : 'Riconnetti Google Drive') : 'Salva backup ora'}
          </button>
        </>
      )}
    </section>
  );
}

/** Attività arrivate da Google Calendar da completare e richiesta di riconnessione. */
function CalendarCards() {
  const { data, openActivity } = useApp();
  const todo = data.activities.filter((a) => a.needsDetails);
  const s = data.settings;
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const stale = !s.calendarLastSyncAt || Date.now() - new Date(s.calendarLastSyncAt).getTime() > 12 * 3_600_000;
  const pending = s.gcalPendingDeletes.length > 0 || data.activities.some(needsPush);
  const reconnect = s.calendarSync && driveAvailable() && !driveToken() && (stale || pending);
  if (todo.length === 0 && !reconnect) return null;
  return (
    <>
      {reconnect && (
        <section className="card">
          <p className="alert warning">Il calendario Google non è aggiornato: l’accesso Google scade dopo un’ora. Tocca per riconnetterti e sincronizzare.</p>
          <button className="btn primary" onClick={() => startDriveAuth('reconnect')}>
            Riconnetti Google
          </button>
        </section>
      )}
      {todo.length > 0 && (
        <section className="card">
          <h2 className="card-title">Da completare ({todo.length})</h2>
          <p className="muted">Eventi aggiunti su Google Calendar: apri ciascuno e indica committente, tipologia e compenso.</p>
          {todo.map((a) => (
            <ActivityRow key={a.id} a={a} client={a.clientId ? clients.get(a.clientId) : undefined} showDate onOpen={() => openActivity({ activity: a })} />
          ))}
        </section>
      )}
    </>
  );
}
