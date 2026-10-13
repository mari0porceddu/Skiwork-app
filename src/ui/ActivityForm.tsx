import { useMemo, useState } from 'react';
import { computeActivity, findApplicableRate, toAppliedRate } from '../domain/compensation';
import { newId } from '../domain/ids';
import { formatEuro } from '../domain/money';
import { detectConflicts, expandWeekly } from '../domain/schedule';
import { SHIFT_KEYS, SHIFT_LABEL, shiftTimes, type ShiftKey } from '../domain/shifts';
import { addDays, crossesMidnight, formatMinutesAsHours, isValidDate, isValidTime, nowHHmm, spanMinutes, todayISO, weekday, weekdayShort } from '../domain/time';
import {
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_TYPE_LABEL,
  ACTIVITY_TYPES,
  LESSON_LEVEL_LABEL,
  LESSON_LEVELS,
  RATE_MODE_LABEL,
  isWorkType,
  type LessonLevel,
  type Activity,
  type ActivityStatus,
  type ActivityType,
  type AppliedRate,
  type RateMode,
} from '../domain/types';
import { createActivitySeries, deleteActivity, needsReason, ReasonRequiredError, saveActivity, saveRecord, setSetting } from '../db/repo';
import { db } from '../db/db';
import { Field, MoneyInput, Segmented } from './components/fields';
import { Sheet } from './components/Sheet';
import { useApp, type ActivityFormRequest } from './context';

function defaultStatus(date: string, end: string, start: string): ActivityStatus {
  const today = todayISO();
  const endDate = crossesMidnight(start, end) ? addDays(date, 1) : date;
  if (endDate < today || (endDate === today && end <= nowHHmm())) return 'completed';
  return 'confirmed';
}

export function ActivityForm({ req, onClose }: { req: ActivityFormRequest; onClose: () => void }) {
  const { data, toast, confirm } = useApp();
  const editing = req.activity;
  const s = data.settings;
  const activeClients = data.clients.filter((c) => c.active || c.id === editing?.clientId);

  const [type, setType] = useState<ActivityType>(editing?.type ?? ((s.lastActivityType as ActivityType | null) ?? 'private_lesson'));
  const [clientId, setClientId] = useState<string | null>(editing ? editing.clientId : (s.lastClientId && activeClients.some((c) => c.id === s.lastClientId) ? s.lastClientId : (activeClients[0]?.id ?? null)));
  const [date, setDate] = useState(editing?.date ?? req.date ?? todayISO());
  const [start, setStart] = useState(editing?.start ?? req.start ?? s.usualStart);
  const [end, setEnd] = useState(editing?.end ?? req.end ?? s.usualEnd);
  const [shift, setShift] = useState<ShiftKey | null>(editing?.shift ?? null);
  const [level, setLevel] = useState<LessonLevel | null>(editing?.level ?? null);
  const [statusTouched, setStatusTouched] = useState(!!editing);
  const [status, setStatusRaw] = useState<ActivityStatus>(editing?.status ?? defaultStatus(date, end, start));

  // Tariffa: 'auto' segue la tariffa configurata applicabile; altrimenti id di tariffa, 'manual' o 'none'.
  const [rateChoice, setRateChoice] = useState<string>(editing ? (editing.rate === null ? 'none' : editing.rate.rateId ?? 'manual') : 'auto');
  const [manualMode, setManualMode] = useState<RateMode>(editing?.rate?.mode ?? 'hourly');
  const [manualAmount, setManualAmount] = useState<number | null>(editing?.rate && editing.rate.rateId === null ? editing.rate.amountCents : null);
  const [saveAsRate, setSaveAsRate] = useState(false);

  const [title, setTitle] = useState(editing?.title ?? '');
  const [location, setLocation] = useState(editing?.location ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [breakMinutes, setBreakMinutes] = useState(String(editing?.breakMinutes ?? 0));
  const [actualMinutes, setActualMinutes] = useState(editing?.actualMinutes != null ? String(editing.actualMinutes) : '');
  const [units, setUnits] = useState(String(editing?.units ?? 1));
  const [adjCents, setAdjCents] = useState<number | null>(editing?.manualAdjustmentCents ?? 0);
  const [adjReason, setAdjReason] = useState(editing?.manualAdjustmentReason ?? '');
  const [cancelFee, setCancelFee] = useState<number | null>(editing?.cancellationFeeCents ?? 0);
  const [reminder, setReminder] = useState(editing?.reminderMinutesBefore != null ? String(editing.reminderMinutesBefore) : '');
  const [repeat, setRepeat] = useState(false);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatUntil, setRepeatUntil] = useState(addDays(date, 28));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const work = isWorkType(type);
  const setStatus = (v: ActivityStatus) => {
    setStatusTouched(true);
    setStatusRaw(v);
  };
  const autoStatus = (d: string, st: string, en: string) => {
    if (!statusTouched && isValidDate(d) && isValidTime(st) && isValidTime(en)) setStatusRaw(defaultStatus(d, en, st));
  };

  const clientRates = data.rates.filter((r) => r.clientId === clientId && (r.activityType === null || r.activityType === type));
  const applicable = clientId && isValidDate(date) ? findApplicableRate(data.rates, clientId, type, date) : null;

  const effectiveChoice = rateChoice === 'auto' ? (applicable ? applicable.id : 'manual') : rateChoice;

  const appliedRate: AppliedRate | null = useMemo(() => {
    if (!work || effectiveChoice === 'none') return null;
    if (effectiveChoice === 'manual') {
      if (manualAmount === null) return null;
      return { rateId: null, label: 'Tariffa manuale', mode: manualMode, amountCents: manualAmount, surchargeBps: 0, commissionBps: 0, fixedDeductionCents: 0, roundingStepMinutes: 0, roundingMode: 'none', currency: 'EUR' };
    }
    // Se si modifica un'attività esistente e la tariffa è la stessa, si conserva lo snapshot originale.
    if (editing?.rate && editing.rate.rateId === effectiveChoice) return editing.rate;
    const r = data.rates.find((x) => x.id === effectiveChoice);
    return r ? toAppliedRate(r) : null;
  }, [work, effectiveChoice, manualAmount, manualMode, data.rates, editing]);

  const timesValid = isValidTime(start) && isValidTime(end) && spanMinutes(start, end) > 0;
  const shiftClient = data.clients.find((c) => c.id === clientId);
  function applyTimes(st: string, en: string) {
    setStart(st);
    setEnd(en);
    autoStatus(date, st, en);
  }

  const draft: Activity | null =
    isValidDate(date) && timesValid
      ? {
          id: editing?.id ?? 'draft',
          title,
          type,
          clientId: work ? clientId : null,
          date,
          start,
          end,
          breakMinutes: Math.max(0, parseInt(breakMinutes, 10) || 0),
          actualMinutes: actualMinutes.trim() === '' ? null : Math.max(0, parseInt(actualMinutes, 10) || 0),
          units: Math.max(1, parseInt(units, 10) || 1),
          status,
          location,
          notes,
          rate: appliedRate,
          manualAdjustmentCents: adjCents ?? 0,
          manualAdjustmentReason: adjReason,
          cancellationFeeCents: cancelFee ?? 0,
          reminderMinutesBefore: reminder.trim() === '' ? null : Math.max(0, parseInt(reminder, 10) || 0),
          seriesId: editing?.seriesId,
          shift: work && shift ? shift : undefined,
          level: work && level ? level : undefined,
          externalUid: editing?.externalUid,
          createdAt: editing?.createdAt ?? '',
          updatedAt: editing?.updatedAt ?? '',
        }
      : null;

  const preview = draft ? computeActivity(draft) : null;
  const clientMap = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);
  const conflicts = useMemo(() => {
    if (!draft || draft.status === 'cancelled') return [];
    const others = data.activities.filter((a) => a.id !== draft.id && Math.abs(new Date(a.date).getTime() - new Date(draft.date).getTime()) <= 86_400_000 * 2);
    return detectConflicts([...others, draft], clientMap, s.defaultTravelMinutes)
      .filter((c) => c.aId === draft.id || c.bId === draft.id)
      .map((c) => {
        const other = data.activities.find((a) => a.id === (c.aId === draft.id ? c.bId : c.aId));
        return { ...c, other };
      });
  }, [draft, data.activities, clientMap, s.defaultTravelMinutes]);

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!isValidDate(date)) e.date = 'Data non valida';
    if (!isValidTime(start)) e.start = 'Orario non valido';
    if (!isValidTime(end)) e.end = 'Orario non valido';
    if (isValidTime(start) && isValidTime(end) && spanMinutes(start, end) === 0) e.end = 'La fine deve essere diversa dall’inizio';
    if (work && !clientId) e.client = 'Seleziona un committente';
    if (work && effectiveChoice === 'manual' && manualAmount === null) e.rate = 'Inserisci l’importo della tariffa oppure scegli “Nessun compenso”';
    if ((adjCents ?? 0) !== 0 && adjReason.trim() === '') e.adj = 'Indica la motivazione della correzione';
    if (adjCents === null) e.adj = 'Importo non valido';
    if (cancelFee === null) e.cancel = 'Importo non valido';
    if (repeat && !editing) {
      if (repeatDays.length === 0) e.repeat = 'Scegli almeno un giorno';
      else if (!isValidDate(repeatUntil) || repeatUntil < date) e.repeat = 'Data finale non valida';
    }
    return e;
  }

  async function onSave() {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0 || !draft) {
      toast('Controlla i campi evidenziati', 'error');
      return;
    }
    setSaving(true);
    try {
      let rate = draft.rate;
      if (work && effectiveChoice === 'manual' && saveAsRate && clientId && manualAmount !== null) {
        const now = new Date().toISOString();
        const saved = await saveRecord('rates', {
          id: newId(),
          clientId,
          activityType: type,
          label: `${ACTIVITY_TYPE_LABEL[type]} ${RATE_MODE_LABEL[manualMode].toLowerCase()}`,
          validFrom: date,
          validTo: null,
          mode: manualMode,
          amountCents: manualAmount,
          surchargeBps: 0,
          commissionBps: 0,
          fixedDeductionCents: 0,
          roundingStepMinutes: 0,
          roundingMode: 'none' as const,
          currency: 'EUR' as const,
          createdAt: now,
          updatedAt: now,
        });
        rate = toAppliedRate(saved);
      }
      const record: Activity = { ...draft, rate, id: editing?.id ?? newId() };
      if (!record.title) record.title = '';

      let reason = '';
      if (editing && needsReason(await db.activities.get(editing.id), record)) {
        const r = await confirm({
          title: 'Modifica di un’attività completata',
          message: 'Stai modificando dati economici di un’attività già completata. La modifica verrà registrata nello storico.',
          confirmLabel: 'Salva modifica',
          reasonLabel: 'Motivazione',
        });
        if (!r.ok) return;
        reason = r.reason;
      }

      if (repeat && !editing) {
        const dates = expandWeekly(date, repeatUntil, repeatDays);
        if (!dates.includes(date)) dates.unshift(date);
        await createActivitySeries(record, dates);
        toast(`${dates.length} attività create`);
      } else {
        await saveActivity(record, reason);
        toast(editing ? 'Attività aggiornata' : 'Attività salvata');
      }
      if (work && clientId) await setSetting('lastClientId', clientId);
      await setSetting('lastActivityType', type);
      if (!editing) {
        await setSetting('usualStart', start);
        await setSetting('usualEnd', end);
      }
      onClose();
    } catch (err) {
      toast(err instanceof ReasonRequiredError ? err.message : `Salvataggio non riuscito: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editing) return;
    const completed = editing.status === 'completed';
    const r = await confirm({
      title: 'Eliminare l’attività?',
      message: completed
        ? 'L’attività è completata: eliminarla rimuove il compenso maturato dai report. Se è stata annullata, usa piuttosto lo stato “Cancellato” per mantenerne lo storico.'
        : 'L’attività verrà eliminata. Per mantenerne lo storico puoi invece impostare lo stato “Cancellato”.',
      confirmLabel: 'Elimina',
      danger: true,
      reasonLabel: completed ? 'Motivazione (obbligatoria)' : undefined,
    });
    if (!r.ok) return;
    try {
      await deleteActivity(editing.id, r.reason);
      toast('Attività eliminata');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const rateOptions = [
    ...clientRates.map((r) => ({ value: r.id, label: `${r.label} · ${formatEuro(r.amountCents)} ${r.mode === 'hourly' ? '/h' : r.mode === 'daily' ? '/giorno' : '/lezione'}${r.activityType ? '' : ' (generica)'}` })),
    { value: 'manual', label: 'Inserisci manualmente…' },
    { value: 'none', label: 'Nessun compenso' },
  ];
  if (editing?.rate?.rateId && !clientRates.some((r) => r.id === editing.rate!.rateId)) {
    rateOptions.unshift({ value: editing.rate.rateId, label: `${editing.rate.label} · ${formatEuro(editing.rate.amountCents)} (applicata)` });
  }

  return (
    <Sheet
      open
      title={editing ? 'Modifica attività' : 'Aggiungi attività'}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <button type="button" className="btn danger ghost" onClick={onDelete}>
              Elimina
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button type="button" className="btn primary" onClick={onSave} disabled={saving}>
            {saving ? 'Salvo…' : 'Salva'}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(ev) => {
          ev.preventDefault();
          void onSave();
        }}
      >
        <Field label="Tipologia">
          {(id) => (
            <select id={id} value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACTIVITY_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </Field>

        {work && (
          <Field label="Committente" error={errors.client}>
            {(id) => (
              <select
                id={id}
                value={clientId ?? ''}
                onChange={(e) => {
                  setClientId(e.target.value || null);
                  const t = shift ? shiftTimes(data.clients.find((c) => c.id === e.target.value), shift) : null;
                  if (t) applyTimes(t.start, t.end);
                  else setShift(null);
                  if (rateChoice !== 'manual' && rateChoice !== 'none') setRateChoice('auto');
                }}
              >
                <option value="">— Seleziona —</option>
                {activeClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        {work && shiftClient && SHIFT_KEYS.some((k) => shiftTimes(shiftClient, k)) && (
          <div className="chips" role="group" aria-label="Turno">
            {SHIFT_KEYS.filter((k) => shiftTimes(shiftClient, k)).map((k) => (
              <button
                key={k}
                type="button"
                className={`chip${shift === k ? ' active' : ''}`}
                aria-pressed={shift === k}
                onClick={() => {
                  if (shift === k) return setShift(null);
                  const t = shiftTimes(shiftClient, k)!;
                  setShift(k);
                  applyTimes(t.start, t.end);
                }}
              >
                {SHIFT_LABEL[k]}
              </button>
            ))}
          </div>
        )}

        <div className="row3">
          <Field label="Data" error={errors.date}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  autoStatus(e.target.value, start, end);
                }}
              />
            )}
          </Field>
          <Field label="Inizio" error={errors.start}>
            {(id) => (
              <input
                id={id}
                type="time"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setShift(null);
                  autoStatus(date, e.target.value, end);
                }}
              />
            )}
          </Field>
          <Field label="Fine" error={errors.end} hint={isValidTime(start) && isValidTime(end) && crossesMidnight(start, end) ? 'Termina il giorno dopo' : undefined}>
            {(id) => (
              <input
                id={id}
                type="time"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setShift(null);
                  autoStatus(date, start, e.target.value);
                }}
              />
            )}
          </Field>
        </div>

        {work && (
          <div className="chips" role="group" aria-label="Livello">
            <span className="muted">Livello</span>
            {LESSON_LEVELS.map((l) => (
              <button key={l} type="button" className={`chip${level === l ? ' active' : ''}`} aria-pressed={level === l} onClick={() => setLevel(level === l ? null : l)}>
                {LESSON_LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
        )}
        {work && (
          <Field label="Tariffa applicabile" error={errors.rate} hint={rateChoice === 'auto' && applicable ? 'Tariffa configurata per committente, tipologia e data' : rateChoice === 'auto' ? 'Nessuna tariffa configurata: inseriscila manualmente' : undefined}>
            {(id) => (
              <select id={id} value={effectiveChoice} onChange={(e) => setRateChoice(e.target.value)}>
                {rateOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        {work && effectiveChoice === 'manual' && (
          <div className="row2">
            <Field label="Modalità">
              {(id) => (
                <select id={id} value={manualMode} onChange={(e) => setManualMode(e.target.value as RateMode)}>
                  {(Object.keys(RATE_MODE_LABEL) as RateMode[]).map((m) => (
                    <option key={m} value={m}>
                      {RATE_MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={manualMode === 'hourly' ? 'Importo all’ora' : manualMode === 'daily' ? 'Importo al giorno' : 'Importo a lezione'}>
              {(id) => <MoneyInput id={id} value={manualAmount} onChange={setManualAmount} />}
            </Field>
            <label className="check">
              <input type="checkbox" checked={saveAsRate} onChange={(e) => setSaveAsRate(e.target.checked)} /> Salva come tariffa del committente per questa tipologia
            </label>
          </div>
        )}

        <Field label="Stato" hint={!statusTouched ? 'Impostato in base a data e ora: modificabile' : undefined}>
          {() => (
            <Segmented
              label="Stato"
              value={status}
              onChange={setStatus}
              options={(Object.keys(ACTIVITY_STATUS_LABEL) as ActivityStatus[]).map((v) => ({ value: v, label: ACTIVITY_STATUS_LABEL[v] }))}
            />
          )}
        </Field>

        {preview && (
          <div className="preview" aria-live="polite">
            <div>
              <span className="muted">Ore previste</span>
              <strong>{formatMinutesAsHours(preview.plannedMinutes)}</strong>
            </div>
            {status === 'completed' ? (
              <div>
                <span className="muted">Compenso maturato</span>
                <strong>{formatEuro(preview.accruedCents)}</strong>
              </div>
            ) : status === 'cancelled' ? (
              <div>
                <span className="muted">Compenso di cancellazione</span>
                <strong>{formatEuro(preview.accruedCents)}</strong>
              </div>
            ) : (
              <div>
                <span className="muted">Compenso previsto</span>
                <strong>{formatEuro(preview.expectedCents)}</strong>
              </div>
            )}
            {preview.lines.length > 1 && (
              <ul className="lines">
                {preview.lines.map((l, i) => (
                  <li key={i}>
                    <span>{l.label}</span>
                    <span>{formatEuro(l.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="alert warning" role="alert">
            {conflicts.map((c, i) => (
              <p key={i}>
                {c.kind === 'overlap' ? 'Si sovrappone a' : `Trasferimento insufficiente (${c.minutes} min mancanti) rispetto a`} “{c.other?.title || (c.other ? ACTIVITY_TYPE_LABEL[c.other.type] : '')}” {c.other?.date} {c.other?.start}–{c.other?.end}
              </p>
            ))}
          </div>
        )}

        <details className="advanced">
          <summary>Dettagli facoltativi</summary>
          <Field label="Titolo">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={ACTIVITY_TYPE_LABEL[type]} />}</Field>
          <Field label="Luogo">{(id) => <input id={id} value={location} onChange={(e) => setLocation(e.target.value)} />}</Field>
          {work && (
            <>
              <div className="row2">
                <Field label="Pausa non retribuita (min)">{(id) => <input id={id} inputMode="numeric" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value.replace(/\D/g, ''))} />}</Field>
                <Field label="Minuti effettivi" hint="Se diversi dal previsto (es. lezione terminata prima)">
                  {(id) => <input id={id} inputMode="numeric" value={actualMinutes} placeholder={preview ? String(preview.plannedMinutes) : ''} onChange={(e) => setActualMinutes(e.target.value.replace(/\D/g, ''))} />}
                </Field>
              </div>
              {appliedRate && appliedRate.mode !== 'hourly' && (
                <Field label={appliedRate.mode === 'daily' ? 'Numero di giornate' : 'Numero di lezioni'}>{(id) => <input id={id} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} />}</Field>
              )}
              <div className="row2">
                <Field label="Correzione manuale (+/−)" error={errors.adj}>
                  {(id) => <MoneyInput id={id} value={adjCents} onChange={setAdjCents} allowNegative />}
                </Field>
                <Field label="Motivazione correzione">{(id) => <input id={id} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />}</Field>
              </div>
              {status === 'cancelled' && (
                <Field label="Compenso di cancellazione" error={errors.cancel}>
                  {(id) => <MoneyInput id={id} value={cancelFee} onChange={setCancelFee} />}
                </Field>
              )}
            </>
          )}
          <Field label="Promemoria (minuti prima)" hint="Visibile nell’app; vedi limiti delle notifiche su iPhone nelle Impostazioni">
            {(id) => <input id={id} inputMode="numeric" value={reminder} onChange={(e) => setReminder(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label="Note">{(id) => <textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          {!editing && (
            <div className="field">
              <label className="check">
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(e) => {
                    setRepeat(e.target.checked);
                    if (e.target.checked && repeatDays.length === 0 && isValidDate(date)) setRepeatDays([weekday(date)]);
                  }}
                />{' '}
                Ripeti ogni settimana
              </label>
              {repeat && (
                <>
                  <div className="chips" role="group" aria-label="Giorni">
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <button key={d} type="button" className={`chip${repeatDays.includes(d) ? ' active' : ''}`} aria-pressed={repeatDays.includes(d)} onClick={() => setRepeatDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))}>
                        {weekdayShort(d)}
                      </button>
                    ))}
                  </div>
                  <Field label="Fino al" error={errors.repeat}>
                    {(id) => <input id={id} type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} />}
                  </Field>
                </>
              )}
            </div>
          )}
        </details>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

