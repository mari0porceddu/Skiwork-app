import { useMemo, useState } from 'react';
import { newId } from '../../domain/ids';
import { computeDayAvailability, detectConflicts, formatInterval, totalMinutes, weekDates } from '../../domain/schedule';
import {
  addDays,
  datesInRange,
  endOfMonth,
  formatDateLong,
  formatMinutesAsHours,
  isValidTime,
  minutesToTime,
  monthName,
  startOfMonth,
  startOfWeek,
  todayISO,
  weekday,
  weekdayShort,
} from '../../domain/time';
import { ACTIVITY_TYPE_LABEL, ACTIVITY_TYPES, AVAILABILITY_KIND_LABEL, type AvailabilityKind, type AvailabilityRule } from '../../domain/types';
import { deleteRecord, saveRecord } from '../../db/repo';
import { ActivityRow } from '../components/ActivityRow';
import { EmptyState, Field, Segmented } from '../components/fields';
import { Sheet } from '../components/Sheet';
import { useApp } from '../context';
import { navigate, useRoute } from '../router';

type View = 'day' | 'week' | 'month' | 'availability';

export function Calendar() {
  const { data, openActivity } = useApp();
  const route = useRoute();
  const view = (route.params.get('view') as View) || 'week';
  const date = route.params.get('date') || todayISO();
  const [clientFilter, setClientFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showCancelled, setShowCancelled] = useState(true);
  const go = (v: View, d: string) => navigate('calendario', { view: v, date: d });
  const clients = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);

  const filtered = data.activities.filter(
    (a) => (!clientFilter || a.clientId === clientFilter) && (!typeFilter || a.type === typeFilter) && (showCancelled || a.status !== 'cancelled'),
  );
  const conflictIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of detectConflicts(data.activities, clients, data.settings.defaultTravelMinutes)) {
      s.add(c.aId);
      s.add(c.bId);
    }
    return s;
  }, [data.activities, clients, data.settings.defaultTravelMinutes]);

  const step = view === 'day' ? 1 : view === 'month' ? 0 : 7;
  const prev = () => go(view, view === 'month' ? startOfMonth(addDays(startOfMonth(date), -1)) : addDays(date, -step));
  const nextP = () => go(view, view === 'month' ? addDays(endOfMonth(date), 1) : addDays(date, step));

  const title =
    view === 'day'
      ? formatDateLong(date)
      : view === 'month'
        ? `${monthName(Number(date.slice(5, 7)) - 1)} ${date.slice(0, 4)}`
        : `Settimana dal ${formatDateLong(startOfWeek(date))}`;

  const dayList = (d: string) =>
    filtered
      .filter((a) => a.date === d)
      .map((a) => (
        <div key={a.id} className={conflictIds.has(a.id) && a.status !== 'cancelled' ? 'conflict' : ''}>
          <ActivityRow a={a} client={a.clientId ? clients.get(a.clientId) : undefined} onOpen={() => openActivity({ activity: a })} />
          {conflictIds.has(a.id) && a.status !== 'cancelled' && <small className="error">⚠ Conflitto con un altro impegno o trasferimento insufficiente</small>}
        </div>
      ));

  return (
    <div className="page">
      <header className="page-header">
        <h1>Calendario</h1>
      </header>
      <Segmented
        label="Vista"
        value={view}
        onChange={(v) => go(v, date)}
        options={[
          { value: 'day', label: 'Giorno' },
          { value: 'week', label: 'Settimana' },
          { value: 'month', label: 'Mese' },
          { value: 'availability', label: 'Disponibilità' },
        ]}
      />
      <div className="toolbar">
        <button className="btn" onClick={prev} aria-label="Periodo precedente">
          ‹
        </button>
        <button className="btn" onClick={() => go(view, todayISO())}>
          Oggi
        </button>
        <button className="btn" onClick={nextP} aria-label="Periodo successivo">
          ›
        </button>
        <strong className="toolbar-title">{title}</strong>
      </div>
      {view !== 'availability' && (
        <div className="filters">
          <select aria-label="Committente" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">Tutti i committenti</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select aria-label="Tipologia" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Tutte le tipologie</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACTIVITY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Cancellati
          </label>
        </div>
      )}

      {view === 'day' && (
        <section className="card">
          {dayList(date).length === 0 ? (
            <EmptyState title="Giornata libera" action={<button className="btn primary" onClick={() => openActivity({ date })}>Aggiungi attività</button>} />
          ) : (
            <div className="list">{dayList(date)}</div>
          )}
          <DayAvailabilitySummary date={date} />
        </section>
      )}

      {view === 'week' && (
        <div className="week">
          {weekDates(date).map((d) => {
            const items = dayList(d);
            return (
              <section key={d} className={`card day-card${d === todayISO() ? ' today' : ''}`}>
                <h2 className="card-title">
                  <button className="link" onClick={() => go('day', d)}>
                    {formatDateLong(d)}
                  </button>
                  <button className="icon-btn" aria-label={`Aggiungi il ${d}`} onClick={() => openActivity({ date: d })}>
                    +
                  </button>
                </h2>
                {items.length === 0 ? <p className="muted small">Nessun impegno</p> : <div className="list">{items}</div>}
              </section>
            );
          })}
        </div>
      )}

      {view === 'month' && <MonthGrid date={date} activities={filtered} onPick={(d) => go('day', d)} colorOf={(id) => (id ? clients.get(id)?.color : undefined)} />}

      {view === 'availability' && <AvailabilityView date={date} />}
    </div>
  );
}

function MonthGrid({ date, activities, onPick, colorOf }: { date: string; activities: { date: string; clientId: string | null; status: string; id: string }[]; onPick: (d: string) => void; colorOf: (id: string | null) => string | undefined }) {
  const first = startOfMonth(date);
  const last = endOfMonth(date);
  const gridStart = startOfWeek(first);
  const gridEnd = addDays(startOfWeek(last), 6);
  const today = todayISO();
  return (
    <div className="month">
      {[0, 1, 2, 3, 4, 5, 6].map((d) => (
        <div key={d} className="month-head">
          {weekdayShort(d)}
        </div>
      ))}
      {datesInRange(gridStart, gridEnd).map((d) => {
        const items = activities.filter((a) => a.date === d && a.status !== 'cancelled');
        return (
          <button key={d} className={`month-cell${d < first || d > last ? ' out' : ''}${d === today ? ' today' : ''}`} onClick={() => onPick(d)} aria-label={`${formatDateLong(d)}: ${items.length} impegni`}>
            <span className="month-day">{Number(d.slice(8))}</span>
            <span className="month-dots">
              {items.slice(0, 4).map((a) => (
                <span key={a.id} className="dot" style={{ background: colorOf(a.clientId) ?? 'var(--muted)' }} />
              ))}
              {items.length > 4 && <span className="small">+{items.length - 4}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DayAvailabilitySummary({ date }: { date: string }) {
  const { data, openActivity } = useApp();
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const av = computeDayAvailability(date, data.availability, data.activities, { clients, defaultTravel: data.settings.defaultTravelMinutes, minSlotMinutes: data.settings.minSlotMinutes });
  return (
    <div className="availability-summary">
      <h3>Slot liberi per nuove lezioni</h3>
      {av.noRules ? (
        <p className="muted small">Nessuna disponibilità configurata per questo giorno. Configurala nella vista Disponibilità.</p>
      ) : av.freeSlots.length === 0 ? (
        <p className="muted small">Nessuno slot libero di almeno {data.settings.minSlotMinutes} minuti.</p>
      ) : (
        <div className="chips">
          {av.freeSlots.map((s) => (
            <button key={s.start} className="chip" onClick={() => openActivity({ date, start: minutesToTime(s.start), end: minutesToTime(Math.min(s.end, s.start + 60)) })}>
              {formatInterval(s)}
            </button>
          ))}
        </div>
      )}
      {av.tentative.length > 0 && <p className="small">Riservato a proposte non confermate: {av.tentative.map(formatInterval).join(', ')}</p>}
    </div>
  );
}

function AvailabilityView({ date }: { date: string }) {
  const { data, openActivity } = useApp();
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const [editing, setEditing] = useState<AvailabilityRule | null>(null);
  const recurring = data.availability.filter((r) => r.date === null);
  const exceptions = data.availability.filter((r) => r.date !== null).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const opts = { clients, defaultTravel: data.settings.defaultTravelMinutes, minSlotMinutes: data.settings.minSlotMinutes };
  const emptyRule = (over: Partial<AvailabilityRule> = {}): AvailabilityRule => ({ id: newId(), kind: 'available', weekdays: [], date: null, start: '09:00', end: '17:00', validFrom: null, validTo: null, note: '', createdAt: '', updatedAt: '', ...over });

  return (
    <>
      <section className="card">
        <h2 className="card-title">Slot liberi della settimana</h2>
        <p className="muted small">
          Slot = fasce “Accetto nuove lezioni” (o, se assenti, “Disponibile”) meno impegni, proposte non confermate e tempi di trasferimento. Durata minima: {data.settings.minSlotMinutes} min.
        </p>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>Giorno</th>
                <th>Slot liberi</th>
                <th className="num">Disponibile</th>
                <th className="num">Occupato</th>
                <th className="num">Proposte</th>
              </tr>
            </thead>
            <tbody>
              {weekDates(date).map((d) => {
                const av = computeDayAvailability(d, data.availability, data.activities, opts);
                return (
                  <tr key={d}>
                    <th scope="row">{formatDateLong(d)}</th>
                    <td>
                      {av.noRules ? (
                        <span className="muted">—</span>
                      ) : av.freeSlots.length === 0 ? (
                        <span className="muted">nessuno</span>
                      ) : (
                        av.freeSlots.map((s) => (
                          <button key={s.start} className="chip" onClick={() => openActivity({ date: d, start: minutesToTime(s.start), end: minutesToTime(Math.min(s.end, s.start + 60)) })}>
                            {formatInterval(s)}
                          </button>
                        ))
                      )}
                    </td>
                    <td className="num">{formatMinutesAsHours(totalMinutes(av.available))}</td>
                    <td className="num">{formatMinutesAsHours(totalMinutes(av.busy))}</td>
                    <td className="num">{formatMinutesAsHours(totalMinutes(av.tentative))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">
          Fasce ricorrenti
          <button className="btn small" onClick={() => setEditing(emptyRule({ weekdays: [weekday(date)] }))}>
            Aggiungi
          </button>
        </h2>
        {recurring.length === 0 ? (
          <EmptyState title="Nessuna fascia configurata">Definisci quando sei disponibile, quando accetti nuove lezioni e quando non sei disponibile.</EmptyState>
        ) : (
          <ul className="rules">
            {recurring.map((r) => (
              <li key={r.id}>
                <button className="rule" onClick={() => setEditing(r)}>
                  <span className={`badge kind-${r.kind}`}>{AVAILABILITY_KIND_LABEL[r.kind]}</span>
                  <span>
                    {r.weekdays
                      .slice()
                      .sort()
                      .map(weekdayShort)
                      .join(', ')}{' '}
                    {r.start}–{r.end === '00:00' ? '24:00' : r.end}
                  </span>
                  {(r.validFrom || r.validTo) && (
                    <span className="muted small">
                      {r.validFrom ?? '…'} → {r.validTo ?? '…'}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">
          Eccezioni per singoli giorni
          <button className="btn small" onClick={() => setEditing(emptyRule({ date, kind: 'unavailable', start: '00:00', end: '00:00' }))}>
            Aggiungi
          </button>
        </h2>
        <p className="muted small">Se un giorno ha eccezioni, queste sostituiscono interamente le fasce ricorrenti di quel giorno.</p>
        {exceptions.length === 0 ? (
          <p className="muted">Nessuna eccezione.</p>
        ) : (
          <ul className="rules">
            {exceptions.map((r) => (
              <li key={r.id}>
                <button className="rule" onClick={() => setEditing(r)}>
                  <span className={`badge kind-${r.kind}`}>{AVAILABILITY_KIND_LABEL[r.kind]}</span>
                  <span>
                    {formatDateLong(r.date!)} {r.start}–{r.end === '00:00' ? '24:00' : r.end}
                  </span>
                  {r.note && <span className="muted small">{r.note}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RuleEditor({ rule, onClose }: { rule: AvailabilityRule; onClose: () => void }) {
  const { data, toast, confirm } = useApp();
  const [r, setR] = useState(rule);
  const exists = data.availability.some((x) => x.id === rule.id);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<AvailabilityRule>) => setR((x) => ({ ...x, ...p }));

  async function save() {
    if (!isValidTime(r.start) || !isValidTime(r.end)) return setError('Orari non validi');
    if (r.end !== '00:00' && r.end <= r.start) return setError('La fine deve essere successiva all’inizio (00:00 = fine giornata)');
    if (r.date === null && r.weekdays.length === 0) return setError('Scegli almeno un giorno della settimana');
    if (r.validFrom && r.validTo && r.validTo < r.validFrom) return setError('Periodo di validità non valido');
    await saveRecord('availability', r);
    toast('Disponibilità salvata');
    onClose();
  }

  async function remove() {
    const c = await confirm({ title: 'Eliminare la fascia?', message: 'La fascia di disponibilità verrà eliminata.', confirmLabel: 'Elimina', danger: true });
    if (!c.ok) return;
    await deleteRecord('availability', r.id);
    toast('Fascia eliminata');
    onClose();
  }

  return (
    <Sheet
      open
      title={r.date ? 'Eccezione per un giorno' : 'Fascia ricorrente'}
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
            <select id={id} value={r.kind} onChange={(e) => set({ kind: e.target.value as AvailabilityKind })}>
              {(Object.keys(AVAILABILITY_KIND_LABEL) as AvailabilityKind[]).map((k) => (
                <option key={k} value={k}>
                  {AVAILABILITY_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {r.date !== null ? (
          <Field label="Giorno">{(id) => <input id={id} type="date" value={r.date ?? ''} onChange={(e) => set({ date: e.target.value })} />}</Field>
        ) : (
          <div className="field">
            <span className="label">Giorni</span>
            <div className="chips" role="group" aria-label="Giorni della settimana">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <button key={d} type="button" className={`chip${r.weekdays.includes(d) ? ' active' : ''}`} aria-pressed={r.weekdays.includes(d)} onClick={() => set({ weekdays: r.weekdays.includes(d) ? r.weekdays.filter((x) => x !== d) : [...r.weekdays, d] })}>
                  {weekdayShort(d)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="row2">
          <Field label="Dalle">{(id) => <input id={id} type="time" value={r.start} onChange={(e) => set({ start: e.target.value })} />}</Field>
          <Field label="Alle" hint="00:00 = fine giornata">
            {(id) => <input id={id} type="time" value={r.end} onChange={(e) => set({ end: e.target.value })} />}
          </Field>
        </div>
        {r.date === null && (
          <div className="row2">
            <Field label="Valida dal (facoltativo)">{(id) => <input id={id} type="date" value={r.validFrom ?? ''} onChange={(e) => set({ validFrom: e.target.value || null })} />}</Field>
            <Field label="Valida fino al (facoltativo)">{(id) => <input id={id} type="date" value={r.validTo ?? ''} onChange={(e) => set({ validTo: e.target.value || null })} />}</Field>
          </div>
        )}
        <Field label="Nota">{(id) => <input id={id} value={r.note} onChange={(e) => set({ note: e.target.value })} />}</Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

