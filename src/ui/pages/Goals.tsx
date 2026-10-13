import { useState } from 'react';
import { goalCurrentValue, goalProgress, goalUnit, type GoalProgress } from '../../domain/goals';
import { newId } from '../../domain/ids';
import { formatEuro } from '../../domain/money';
import { endOfMonth, formatDateShort, formatMinutesAsHours, isValidDate, startOfMonth, todayISO } from '../../domain/time';
import { GOAL_METRIC_LABEL, type Goal, type GoalMetric } from '../../domain/types';
import { deleteRecord, saveRecord } from '../../db/repo';
import { EmptyState, Field, MoneyInput } from '../components/fields';
import { Sheet } from '../components/Sheet';
import { useApp } from '../context';

function fmt(goal: Goal, v: number): string {
  const u = goalUnit(goal.metric);
  if (u === 'cents') return formatEuro(Math.round(v));
  if (u === 'minutes') return formatMinutesAsHours(Math.round(v));
  return `${Math.round(v * 10) / 10} gg`;
}

const STATUS_LABEL: Record<GoalProgress['status'], string> = {
  reached: 'Raggiunto',
  on_track: 'In linea',
  behind: 'In ritardo',
  not_started: 'Non iniziato',
  ended: 'Periodo concluso',
};

export function GoalBar({ goal, progress: p, compact = false, onOpen }: { goal: Goal; progress: GoalProgress; compact?: boolean; onOpen?: () => void }) {
  const { data } = useApp();
  const client = goal.clientId ? data.clients.find((c) => c.id === goal.clientId) : null;
  const elapsedPct = (p.daysElapsed / p.daysTotal) * 100;
  const inner = (
    <>
      <div className="goal-head">
        <strong>{goal.label || GOAL_METRIC_LABEL[goal.metric]}</strong>
        <span className={`badge goal-${p.status}`}>{STATUS_LABEL[p.status]}</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, p.pct)} aria-label={goal.label || GOAL_METRIC_LABEL[goal.metric]}>
        <div className="progress-fill" style={{ width: `${Math.min(100, p.pct)}%` }} />
        <div className="progress-marker" style={{ left: `${elapsedPct}%` }} title="Tempo trascorso" />
      </div>
      <div className="goal-meta">
        <span>
          {fmt(goal, p.current)} / {fmt(goal, p.target)} ({p.pct.toLocaleString('it-IT')}%)
        </span>
        {!compact && <span>Mancano {fmt(goal, p.remaining)}</span>}
      </div>
      {!compact && (
        <div className="goal-meta muted small">
          <span>
            {formatDateShort(goal.periodFrom)} → {formatDateShort(goal.periodTo)}
            {client ? ` · ${client.name}` : ' · tutti i committenti'}
          </span>
          <span>
            {p.requiredPerDay !== null ? `Ritmo necessario: ${fmt(goal, p.requiredPerDay)}/giorno` : ''}
            {p.projected !== null && p.status !== 'reached' ? ` · Proiezione: ${fmt(goal, p.projected)}` : ''}
            {p.forecastDate && p.status !== 'reached' ? ` · Previsto il ${formatDateShort(p.forecastDate)}` : ''}
          </span>
        </div>
      )}
    </>
  );
  return onOpen ? (
    <button className="goal" onClick={onOpen}>
      {inner}
    </button>
  ) : (
    <div className="goal">{inner}</div>
  );
}

export function Goals() {
  const { data } = useApp();
  const today = todayISO();
  const [editing, setEditing] = useState<Goal | null>(null);
  const sorted = [...data.goals].sort((a, b) => b.periodTo.localeCompare(a.periodTo));
  const active = sorted.filter((g) => g.periodTo >= today);
  const past = sorted.filter((g) => g.periodTo < today);
  const newGoal = (): Goal => ({ id: newId(), metric: 'private_lesson_hours', label: '', target: 0, periodFrom: startOfMonth(today), periodTo: endOfMonth(today), clientId: null, createdAt: '', updatedAt: '' });
  const bar = (g: Goal) => <GoalBar key={g.id} goal={g} progress={goalProgress(g, goalCurrentValue(g, data.activities, data.payments, today), today)} onOpen={() => setEditing(g)} />;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Obiettivi</h1>
        <button className="btn primary" onClick={() => setEditing(newGoal())}>
          Nuovo obiettivo
        </button>
      </header>
      <p className="muted small">Il valore attuale considera solo dati consuntivi (attività completate e incassi registrati), mai gli importi previsti. La linea verticale indica il tempo trascorso del periodo.</p>
      {active.length === 0 ? (
        <EmptyState title="Nessun obiettivo attivo" action={<button className="btn primary" onClick={() => setEditing(newGoal())}>Crea un obiettivo</button>}>
          Ad esempio: 120 ore di lezioni private nella stagione, o un guadagno incassato mensile.
        </EmptyState>
      ) : (
        <section className="card">{active.map(bar)}</section>
      )}
      {past.length > 0 && (
        <section className="card">
          <h2 className="card-title">Obiettivi conclusi</h2>
          {past.map(bar)}
        </section>
      )}
      {editing && <GoalEditor goal={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GoalEditor({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { data, toast, confirm } = useApp();
  const [g, setG] = useState(goal);
  const unit = goalUnit(g.metric);
  const [hours, setHours] = useState(unit === 'minutes' ? String(goal.target / 60).replace('.', ',') : String(goal.target));
  const [cents, setCents] = useState<number | null>(unit === 'cents' ? goal.target : null);
  const [error, setError] = useState<string | null>(null);
  const exists = data.goals.some((x) => x.id === goal.id);
  const set = (p: Partial<Goal>) => setG((x) => ({ ...x, ...p }));

  async function save() {
    let target: number;
    if (unit === 'cents') {
      if (cents === null || cents <= 0) return setError('Inserisci un importo valido');
      target = cents;
    } else {
      const n = Number(hours.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) return setError('Inserisci un valore valido');
      target = unit === 'minutes' ? Math.round(n * 60) : Math.round(n);
    }
    if (!isValidDate(g.periodFrom) || !isValidDate(g.periodTo) || g.periodTo < g.periodFrom) return setError('Periodo non valido');
    await saveRecord('goals', { ...g, target });
    toast('Obiettivo salvato');
    onClose();
  }

  async function remove() {
    const c = await confirm({ title: 'Eliminare l’obiettivo?', message: 'L’obiettivo verrà eliminato.', confirmLabel: 'Elimina', danger: true });
    if (!c.ok) return;
    await deleteRecord('goals', g.id);
    onClose();
  }

  return (
    <Sheet
      open
      title={exists ? 'Modifica obiettivo' : 'Nuovo obiettivo'}
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
        <Field label="Tipo di obiettivo">
          {(id) => (
            <select id={id} value={g.metric} onChange={(e) => set({ metric: e.target.value as GoalMetric })}>
              {(Object.keys(GOAL_METRIC_LABEL) as GoalMetric[]).map((m) => (
                <option key={m} value={m}>
                  {GOAL_METRIC_LABEL[m]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {unit === 'cents' ? (
          <Field label="Valore target">{(id) => <MoneyInput id={id} value={cents} onChange={setCents} />}</Field>
        ) : (
          <Field label={unit === 'minutes' ? 'Ore target' : 'Giorni target'}>{(id) => <input id={id} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />}</Field>
        )}
        <div className="row2">
          <Field label="Dal">{(id) => <input id={id} type="date" value={g.periodFrom} onChange={(e) => set({ periodFrom: e.target.value })} />}</Field>
          <Field label="Al">{(id) => <input id={id} type="date" value={g.periodTo} onChange={(e) => set({ periodTo: e.target.value })} />}</Field>
        </div>
        <Field label="Committente">
          {(id) => (
            <select id={id} value={g.clientId ?? ''} onChange={(e) => set({ clientId: e.target.value || null })}>
              <option value="">Tutti (obiettivo complessivo)</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Nome (facoltativo)">{(id) => <input id={id} value={g.label} onChange={(e) => set({ label: e.target.value })} />}</Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
