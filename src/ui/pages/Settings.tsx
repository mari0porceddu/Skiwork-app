import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { exportIcs, parseIcs } from '../../domain/ics';
import { newId } from '../../domain/ids';
import { formatBps, formatEuro, parsePercentToBps } from '../../domain/money';
import { REMINDER_CATEGORY_LABEL, type ReminderCategory } from '../../domain/reminders';
import { formatDateShort, todayISO } from '../../domain/time';
import {
  ACTIVITY_TYPE_LABEL,
  ACTIVITY_TYPES,
  CLIENT_KIND_LABEL,
  RATE_MODE_LABEL,
  ROUNDING_MODE_LABEL,
  type ActivityType,
  type Client,
  type ClientKind,
  type Rate,
  type RateMode,
  type RoundingMode,
} from '../../domain/types';
import { db } from '../../db/db';
import { mergeBackup, parseBackupText, restoreBackup } from '../../db/backup';
import { deleteRecord, importIcsEvents, saveClientAndRealignShifts, saveRecord, setSetting } from '../../db/repo';
import { createBackupFile } from '../backupActions';
import { driveAvailable, driveToken, forgetDriveToken, startDriveAuth, takeAuthResult } from '../../sync/drive';
import { recoverFromDrive, syncToDrive } from '../../sync/driveSync';
import { SHIFT_KEYS, SHIFT_LABEL, shiftTimes } from '../../domain/shifts';
import { EmptyState, Field, MoneyInput, Segmented } from '../components/fields';
import { Sheet } from '../components/Sheet';
import { useApp } from '../context';
import { saveFile } from '../download';

export function Settings() {
  const { data, toast, confirm } = useApp();
  const s = data.settings;
  const [client, setClient] = useState<Client | null>(null);
  const [rate, setRate] = useState<Rate | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const audit = useLiveQuery(() => db.audit.orderBy('at').reverse().limit(30).toArray(), []);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage?.estimate?.().then(setEstimate);
  }, []);

  const clientsById = new Map(data.clients.map((c) => [c.id, c]));

  async function doBackup() {
    await createBackupFile();
    toast('Backup creato');
  }

  async function doRestore(file: File) {
    const v = parseBackupText(await file.text());
    if (!v.ok || !v.data) {
      toast(`File non valido: ${v.errors.slice(0, 3).join('; ')}`, 'error');
      return;
    }
    const t = v.data.tables;
    const c = await confirm({
      title: 'Ripristinare il backup?',
      message: `Tutti i dati attuali verranno SOSTITUITI con quelli del backup del ${formatDateShort(v.data.exportedAt.slice(0, 10))} (${t.activities.length} attività, ${t.documents.length} documenti, ${t.payments.length} pagamenti). Consiglio: crea prima un backup dei dati attuali.`,
      confirmLabel: 'Sostituisci i dati',
      danger: true,
    });
    if (!c.ok) return;
    try {
      await restoreBackup(v.data);
      toast('Backup ripristinato');
    } catch (e) {
      toast(`Ripristino non riuscito, nessun dato modificato: ${(e as Error).message}`, 'error');
    }
  }

  async function doMerge(file: File) {
    const v = parseBackupText(await file.text());
    if (!v.ok || !v.data) {
      toast(`File non valido: ${v.errors.slice(0, 3).join('; ')}`, 'error');
      return;
    }
    try {
      const r = await mergeBackup(v.data);
      const parts = [`${r.activities} attività aggiunte`];
      if (r.clients) parts.push(`${r.clients} committenti nuovi`);
      if (r.other) parts.push(`${r.other} altri elementi`);
      if (r.skippedDuplicates) parts.push(`${r.skippedDuplicates} già presenti ignorate`);
      toast(parts.join(', '));
    } catch (e) {
      toast(`Importazione non riuscita, nessun dato modificato: ${(e as Error).message}`, 'error');
    }
  }

  async function doIcsImport(file: File) {
    const { events, skipped } = parseIcs(await file.text());
    if (events.length === 0) {
      toast(skipped.length ? `Nessun evento importabile (${skipped.length} scartati)` : 'Nessun evento trovato', 'error');
      return;
    }
    const r = await importIcsEvents(events);
    toast(`ICS: ${r.created} creati, ${r.updated} aggiornati, ${r.skipped.length + skipped.length} ignorati`);
  }

  async function requestPersist() {
    const ok = await navigator.storage?.persist?.();
    setPersisted(!!ok);
    toast(ok ? 'Archiviazione persistente attiva' : 'Il browser non ha concesso l’archiviazione persistente', ok ? 'ok' : 'error');
  }

  const newClient = (): Client => ({ id: newId(), name: '', kind: 'other', color: '#16a34a', travelMinutes: 0, documentationMode: 'Fattura (partita IVA)', billingPeriodicity: '', paymentTermsDays: null, paymentMethod: '', adminNotes: '', notes: '', active: true, createdAt: '', updatedAt: '' });
  const newRate = (clientId: string): Rate => ({ id: newId(), clientId, activityType: null, label: '', validFrom: todayISO(), validTo: null, mode: 'hourly', amountCents: 0, surchargeBps: 0, commissionBps: 0, fixedDeductionCents: 0, roundingStepMinutes: 0, roundingMode: 'none', currency: 'EUR', createdAt: '', updatedAt: '' });

  const daysSinceBackup = s.lastBackupAt ? Math.floor((Date.now() - new Date(s.lastBackupAt).getTime()) / 86_400_000) : null;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Impostazioni</h1>
      </header>

      <section className="card">
        <h2 className="card-title">Aspetto</h2>
        <Segmented
          label="Tema"
          value={s.theme}
          onChange={(v) => setSetting('theme', v)}
          options={[
            { value: 'system', label: 'Automatico' },
            { value: 'light', label: 'Chiaro' },
            { value: 'dark', label: 'Scuro' },
          ]}
        />
      </section>

      <section className="card" id="committenti">
        <h2 className="card-title">
          Committenti
          <button className="btn small" onClick={() => setClient(newClient())}>
            Aggiungi
          </button>
        </h2>
        <ul className="rules">
          {data.clients.map((c) => (
            <li key={c.id}>
              <button className="rule" onClick={() => setClient(c)}>
                <span className="dot" style={{ background: c.color }} />
                <span>
                  <strong>{c.name}</strong> <span className="muted small">{CLIENT_KIND_LABEL[c.kind]}</span>
                  {!c.active && <span className="badge">Non attivo</span>}
                </span>
                <span className="muted small">
                  {c.paymentTermsDays !== null ? `Pagamento a ${c.paymentTermsDays} gg` : 'Termine non configurato'} · {c.billingPeriodicity || 'periodicità da configurare'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" id="tariffe">
        <h2 className="card-title">Tariffe</h2>
        <p className="muted small">Ogni attività conserva una copia della tariffa applicata: modificare o sostituire una tariffa non altera i compensi già registrati. Per un cambio di tariffa, chiudi la validità della precedente e creane una nuova.</p>
        {data.clients.map((c) => {
          const rates = data.rates.filter((r) => r.clientId === c.id).sort((a, b) => b.validFrom.localeCompare(a.validFrom));
          return (
            <div key={c.id} className="rate-group">
              <h3>
                <span className="dot" style={{ background: c.color }} />
                {c.name}
                <button className="btn small" onClick={() => setRate(newRate(c.id))}>
                  + Tariffa
                </button>
              </h3>
              {rates.length === 0 ? (
                <p className="muted small">Nessuna tariffa configurata. Puoi anche inserirla direttamente quando registri un’attività.</p>
              ) : (
                <ul className="rules">
                  {rates.map((r) => (
                    <li key={r.id}>
                      <button className="rule" onClick={() => setRate(r)}>
                        <span>
                          <strong>{r.label || RATE_MODE_LABEL[r.mode]}</strong> · {r.activityType ? ACTIVITY_TYPE_LABEL[r.activityType] : 'tutte le tipologie'}
                        </span>
                        <span>
                          {formatEuro(r.amountCents)} {r.mode === 'hourly' ? '/ora' : r.mode === 'daily' ? '/giorno' : '/lezione'}
                          {r.commissionBps ? ` · comm. ${formatBps(r.commissionBps)}` : ''}
                          {r.surchargeBps ? ` · magg. ${formatBps(r.surchargeBps)}` : ''}
                          {r.fixedDeductionCents ? ` · tratt. ${formatEuro(r.fixedDeductionCents)}` : ''}
                        </span>
                        <span className="muted small">
                          dal {formatDateShort(r.validFrom)}
                          {r.validTo ? ` al ${formatDateShort(r.validTo)}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2 className="card-title">Calendario e disponibilità</h2>
        <div className="row2">
          <NumberSetting label="Trasferimento predefinito (min)" value={s.defaultTravelMinutes} onSave={(v) => setSetting('defaultTravelMinutes', v)} hint="Usato tra impegni in luoghi diversi, in aggiunta ai tempi per committente" />
          <NumberSetting label="Durata minima slot libero (min)" value={s.minSlotMinutes} onSave={(v) => setSetting('minSlotMinutes', v)} />
        </div>
        <div className="row2">
          <TextSetting label="Inizio stagione (MM-GG)" value={s.seasonStart} pattern={/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/} onSave={(v) => setSetting('seasonStart', v)} />
          <TextSetting label="Fine stagione (MM-GG)" value={s.seasonEnd} pattern={/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/} onSave={(v) => setSetting('seasonEnd', v)} />
        </div>
        <p className="muted small">Le fasce di disponibilità si gestiscono in Calendario → Disponibilità.</p>
      </section>

      <section className="card">
        <h2 className="card-title">Promemoria</h2>
        <p className="muted small">
          I promemoria sono calcolati dai dati e mostrati nella dashboard e in Documenti e scadenze. Le notifiche di sistema in background non sono ancora attive: su iPhone una PWA può ricevere notifiche in background solo tramite Web Push con un server, che SkiWork non usa (vedi docs/IOS.md).
        </p>
        {(Object.keys(REMINDER_CATEGORY_LABEL) as ReminderCategory[]).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={s.reminders.enabled[k]} onChange={(e) => setSetting('reminders', { ...s.reminders, enabled: { ...s.reminders.enabled, [k]: e.target.checked } })} /> {REMINDER_CATEGORY_LABEL[k]}
          </label>
        ))}
        <div className="row2">
          <NumberSetting label="Anticipo impegni (ore)" value={s.reminders.upcomingHours} onSave={(v) => setSetting('reminders', { ...s.reminders, upcomingHours: v })} />
          <NumberSetting label="Anticipo scadenze pagamento (giorni)" value={s.reminders.paymentDueDays} onSave={(v) => setSetting('reminders', { ...s.reminders, paymentDueDays: v })} />
          <NumberSetting label="Anticipo scadenze fiscali (giorni)" value={s.reminders.fiscalDueDays} onSave={(v) => setSetting('reminders', { ...s.reminders, fiscalDueDays: v })} />
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Fiscale</h2>
        <p className="small">
          Parametri, stima, simulazioni, scadenze e accantonamento manuale sono nella sezione <a href="#/fisco">Fisco</a>.
        </p>
      </section>

      <section className="card" id="dati">
        <h2 className="card-title">Dati, backup e calendario</h2>
        <p className={`alert ${daysSinceBackup === null || daysSinceBackup > 7 ? 'warning' : 'info'}`}>
          I dati sono salvati solo su questo dispositivo, nel database del browser. Se cancelli i dati del sito, disinstalli la PWA o il sistema libera spazio, i dati possono andare persi senza un backup. Ultimo backup: {s.lastBackupAt ? formatDateShort(s.lastBackupAt.slice(0, 10)) : 'mai'}.
        </p>
        <p className="small">
          Archiviazione persistente: <strong>{persisted === null ? 'non verificabile' : persisted ? 'attiva' : 'non attiva'}</strong>
          {estimate?.usage !== undefined && ` · spazio usato ${(estimate.usage / 1024 / 1024).toFixed(1)} MB`}{' '}
          {persisted === false && (
            <button className="btn small" onClick={requestPersist}>
              Richiedi
            </button>
          )}
        </p>
        {driveAvailable() && <DriveSection />}
        <p className="muted">“Ripristina” sostituisce tutti i dati con quelli del file. “Aggiungi dati” invece unisce il file ai dati attuali senza cancellare nulla: le attività già presenti vengono ignorate e i committenti con lo stesso nome vengono riconosciuti.</p>
        <div className="btn-group wrap">
          <button className="btn primary" onClick={doBackup}>
            Scarica backup completo (JSON)
          </button>
          <label className="btn">
            Ripristina da backup…
            <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doRestore(e.target.files[0]).finally(() => (e.target.value = ''))} />
          </label>
          <label className="btn">
            Aggiungi dati da file…
            <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doMerge(e.target.files[0]).finally(() => (e.target.value = ''))} />
          </label>
          <button
            className="btn"
            onClick={() =>
              saveFile(
                `skiwork-${todayISO()}.ics`,
                exportIcs(
                  data.activities.filter((a) => a.status !== 'cancelled'),
                  new Map(data.clients.map((c) => [c.id, c.name])),
                ),
                'text/calendar',
              )
            }
          >
            Esporta calendario (ICS)
          </button>
          <label className="btn">
            Importa calendario (ICS)…
            <input type="file" accept="text/calendar,.ics" hidden onChange={(e) => e.target.files?.[0] && doIcsImport(e.target.files[0]).finally(() => (e.target.value = ''))} />
          </label>
        </div>
        <p className="muted small">L’importazione ICS crea attività di tipo “Altro” senza compenso: assegna poi committente e tariffa. Reimportare lo stesso file non crea duplicati. Le attività completate o cancellate non vengono modificate.</p>
      </section>

      <section className="card">
        <h2 className="card-title">Registro modifiche (ultime 30)</h2>
        {!audit || audit.length === 0 ? (
          <EmptyState title="Nessuna modifica registrata" />
        ) : (
          <ul className="audit">
            {audit.map((e) => (
              <li key={e.id}>
                <span className="muted small">{new Date(e.at).toLocaleString('it-IT')}</span>{' '}
                <strong>
                  {e.action} {e.entity}
                </strong>{' '}
                <span className="small">{Object.keys(e.changes).slice(0, 6).join(', ')}</span>
                {e.reason && <em className="small"> — {e.reason}</em>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Informazioni</h2>
        <p className="small">SkiWork {__APP_VERSION__} · nessuna AI, nessuna telemetria, nessun servizio a pagamento. Tutti i calcoli sono deterministici e documentati in docs/CALCOLI.md. <a href="./privacy.html">Informativa sulla privacy</a></p>
      </section>

      {client && <ClientEditor client={client} onClose={() => setClient(null)} />}
      {rate && <RateEditor rate={rate} clientName={clientsById.get(rate.clientId)?.name ?? ''} onClose={() => setRate(null)} />}
    </div>
  );
}

function NumberSetting({ label, value, onSave, hint }: { label: string; value: number; onSave: (v: number) => Promise<void>; hint?: string }) {
  const [v, setV] = useState(String(value));
  const { toast } = useApp();
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          inputMode="numeric"
          value={v}
          onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
          onBlur={async () => {
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n !== value) {
              await onSave(n);
              toast('Impostazione salvata');
            } else setV(String(value));
          }}
        />
      )}
    </Field>
  );
}

function TextSetting({ label, value, onSave, pattern }: { label: string; value: string; onSave: (v: string) => Promise<void>; pattern: RegExp }) {
  const [v, setV] = useState(value);
  const { toast } = useApp();
  return (
    <Field label={label} error={pattern.test(v) ? null : 'Formato non valido'}>
      {(id) => (
        <input
          id={id}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={async () => {
            if (pattern.test(v) && v !== value) {
              await onSave(v);
              toast('Impostazione salvata');
            }
          }}
        />
      )}
    </Field>
  );
}

function ClientEditor({ client, onClose }: { client: Client; onClose: () => void }) {
  const { data, toast, confirm } = useApp();
  const [c, setC] = useState(client);
  const [error, setError] = useState<string | null>(null);
  const exists = data.clients.some((x) => x.id === client.id);
  const set = (p: Partial<Client>) => setC((x) => ({ ...x, ...p }));
  const used = data.activities.some((a) => a.clientId === c.id) || data.documents.some((d) => d.clientId === c.id) || data.rates.some((r) => r.clientId === c.id);

  async function save() {
    if (c.name.trim() === '') return setError('Inserisci il nome');
    for (const k of SHIFT_KEYS) {
      const t = c.shifts?.[k];
      if (t && (t.start || t.end) && !shiftTimes(c, k)) return setError(`Orari del turno ${SHIFT_LABEL[k].toLowerCase()} non validi`);
    }
    const shifts = Object.fromEntries(SHIFT_KEYS.flatMap((k) => (shiftTimes(c, k) ? [[k, c.shifts![k]!]] : [])));
    const next: Client = { ...c, name: c.name.trim() };
    if (Object.keys(shifts).length > 0) next.shifts = shifts;
    else delete next.shifts;
    const moved = await saveClientAndRealignShifts(next);
    toast(moved > 0 ? `Committente salvato, orari aggiornati su ${moved} attività` : 'Committente salvato');
    onClose();
  }
  async function remove() {
    if (used) {
      const r = await confirm({ title: 'Committente in uso', message: 'Il committente ha attività, tariffe o documenti collegati: non può essere eliminato. Vuoi disattivarlo? Resterà nello storico ma non verrà proposto nei nuovi inserimenti.', confirmLabel: 'Disattiva' });
      if (r.ok) {
        await saveRecord('clients', { ...c, active: false });
        onClose();
      }
      return;
    }
    const r = await confirm({ title: 'Eliminare il committente?', message: c.name, confirmLabel: 'Elimina', danger: true });
    if (!r.ok) return;
    await deleteRecord('clients', c.id);
    onClose();
  }

  return (
    <Sheet
      open
      title={exists ? c.name : 'Nuovo committente'}
      onClose={onClose}
      footer={
        <>
          {exists && (
            <button className="btn danger ghost" onClick={remove}>
              {used ? 'Disattiva' : 'Elimina'}
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
        <div className="row2">
          <Field label="Nome">{(id) => <input id={id} value={c.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
          <Field label="Tipologia">
            {(id) => (
              <select id={id} value={c.kind} onChange={(e) => set({ kind: e.target.value as ClientKind })}>
                {(Object.keys(CLIENT_KIND_LABEL) as ClientKind[]).map((k) => (
                  <option key={k} value={k}>
                    {CLIENT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="row2">
          <Field label="Colore nel calendario">{(id) => <input id={id} type="color" value={c.color} onChange={(e) => set({ color: e.target.value })} />}</Field>
          <Field label="Tempo di trasferimento (min)">{(id) => <input id={id} inputMode="numeric" value={c.travelMinutes} onChange={(e) => set({ travelMinutes: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} />}</Field>
        </div>
        <h3>Turni</h3>
        <p className="muted">Orari usati quando segni un’attività come mattina, pomeriggio o giornata intera. Se li cambi, si aggiornano anche le attività non ancora svolte. Lascia vuoto un turno che non usi.</p>
        {SHIFT_KEYS.map((k) => (
          <div className="row2" key={k}>
            <Field label={`${SHIFT_LABEL[k]}: inizio`}>{(id) => <input id={id} type="time" value={c.shifts?.[k]?.start ?? ''} onChange={(e) => set({ shifts: { ...c.shifts, [k]: { start: e.target.value, end: c.shifts?.[k]?.end ?? '' } } })} />}</Field>
            <Field label={`${SHIFT_LABEL[k]}: fine`}>{(id) => <input id={id} type="time" value={c.shifts?.[k]?.end ?? ''} onChange={(e) => set({ shifts: { ...c.shifts, [k]: { start: c.shifts?.[k]?.start ?? '', end: e.target.value } } })} />}</Field>
          </div>
        ))}
        <h3>Amministrazione</h3>
        <Field label="Modalità di documentazione">{(id) => <input id={id} value={c.documentationMode} onChange={(e) => set({ documentationMode: e.target.value })} />}</Field>
        <div className="row2">
          <Field label="Periodicità concordata" hint="Es. a fine stagione, ogni mese, a richiesta">
            {(id) => <input id={id} value={c.billingPeriodicity} onChange={(e) => set({ billingPeriodicity: e.target.value })} />}
          </Field>
          <Field label="Termine di pagamento (giorni)" hint="Vuoto = non configurato">
            {(id) => <input id={id} inputMode="numeric" value={c.paymentTermsDays ?? ''} onChange={(e) => set({ paymentTermsDays: e.target.value === '' ? null : parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} />}
          </Field>
        </div>
        <Field label="Modalità di pagamento">{(id) => <input id={id} value={c.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })} />}</Field>
        <Field label="Note amministrative (scadenze di invio, condizioni…)">{(id) => <textarea id={id} rows={2} value={c.adminNotes} onChange={(e) => set({ adminNotes: e.target.value })} />}</Field>
        <Field label="Note">{(id) => <textarea id={id} rows={2} value={c.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
        <label className="check">
          <input type="checkbox" checked={c.active} onChange={(e) => set({ active: e.target.checked })} /> Attivo
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function RateEditor({ rate, clientName, onClose }: { rate: Rate; clientName: string; onClose: () => void }) {
  const { data, toast, confirm } = useApp();
  const [r, setR] = useState(rate);
  const [amount, setAmount] = useState<number | null>(rate.amountCents || null);
  const [fixed, setFixed] = useState<number | null>(rate.fixedDeductionCents);
  const [surcharge, setSurcharge] = useState(rate.surchargeBps ? String(rate.surchargeBps / 100).replace('.', ',') : '');
  const [commission, setCommission] = useState(rate.commissionBps ? String(rate.commissionBps / 100).replace('.', ',') : '');
  const [error, setError] = useState<string | null>(null);
  const exists = data.rates.some((x) => x.id === rate.id);
  const set = (p: Partial<Rate>) => setR((x) => ({ ...x, ...p }));

  async function save() {
    const sb = parsePercentToBps(surcharge);
    const cb = parsePercentToBps(commission);
    if (amount === null || amount <= 0) return setError('Inserisci l’importo della tariffa');
    if (sb === null || cb === null || cb > 10000) return setError('Percentuali non valide');
    if (fixed === null || fixed < 0) return setError('Trattenuta non valida');
    if (r.validTo && r.validTo < r.validFrom) return setError('Periodo di validità non valido');
    await saveRecord('rates', { ...r, amountCents: amount, surchargeBps: sb, commissionBps: cb, fixedDeductionCents: fixed, label: r.label.trim() || `${r.activityType ? ACTIVITY_TYPE_LABEL[r.activityType] : 'Tariffa'} ${RATE_MODE_LABEL[r.mode].toLowerCase()}` });
    toast('Tariffa salvata');
    onClose();
  }
  async function remove() {
    const c = await confirm({ title: 'Eliminare la tariffa?', message: 'Le attività già registrate conservano la tariffa applicata e non cambiano.', confirmLabel: 'Elimina', danger: true });
    if (!c.ok) return;
    await deleteRecord('rates', r.id);
    onClose();
  }

  return (
    <Sheet
      open
      title={`Tariffa · ${clientName}`}
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
        <Field label="Nome (facoltativo)">{(id) => <input id={id} value={r.label} onChange={(e) => set({ label: e.target.value })} />}</Field>
        <div className="row2">
          <Field label="Tipologia di attività">
            {(id) => (
              <select id={id} value={r.activityType ?? ''} onChange={(e) => set({ activityType: (e.target.value || null) as ActivityType | null })}>
                <option value="">Tutte</option>
                {ACTIVITY_TYPES.filter((t) => t !== 'personal').map((t) => (
                  <option key={t} value={t}>
                    {ACTIVITY_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Modalità di calcolo">
            {(id) => (
              <select id={id} value={r.mode} onChange={(e) => set({ mode: e.target.value as RateMode })}>
                {(Object.keys(RATE_MODE_LABEL) as RateMode[]).map((m) => (
                  <option key={m} value={m}>
                    {RATE_MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label={r.mode === 'hourly' ? 'Importo all’ora' : r.mode === 'daily' ? 'Importo al giorno' : 'Importo a lezione'}>{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
        <div className="row3">
          <Field label="Maggiorazione %">{(id) => <input id={id} inputMode="decimal" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} placeholder="0" />}</Field>
          <Field label="Commissione %" hint="Trattenuta dal committente">
            {(id) => <input id={id} inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="0" />}
          </Field>
          <Field label="Trattenuta fissa">{(id) => <MoneyInput id={id} value={fixed} onChange={setFixed} />}</Field>
        </div>
        {r.mode === 'hourly' && (
          <div className="row2">
            <Field label="Arrotondamento minuti">
              {(id) => (
                <select id={id} value={r.roundingMode} onChange={(e) => set({ roundingMode: e.target.value as RoundingMode })}>
                  {(Object.keys(ROUNDING_MODE_LABEL) as RoundingMode[]).map((m) => (
                    <option key={m} value={m}>
                      {ROUNDING_MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {r.roundingMode !== 'none' && (
              <Field label="Passo (minuti)">{(id) => <input id={id} inputMode="numeric" value={r.roundingStepMinutes} onChange={(e) => set({ roundingStepMinutes: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} />}</Field>
            )}
          </div>
        )}
        <div className="row2">
          <Field label="Valida dal">{(id) => <input id={id} type="date" value={r.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />}</Field>
          <Field label="Valida fino al (facoltativo)">{(id) => <input id={id} type="date" value={r.validTo ?? ''} onChange={(e) => set({ validTo: e.target.value || null })} />}</Field>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function DriveSection() {
  const { data, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const s = data.settings;
  const token = driveToken();
  useEffect(() => {
    const r = takeAuthResult();
    if (r.kind === 'ok') toast('Google Drive collegato: salvataggio automatico attivo');
    if (r.kind === 'error') toast(r.message, 'error');
  }, [toast]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(`Google Drive: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="drive-box">
      <h3>Salvataggio automatico su Google Drive</h3>
      {!s.driveSync ? (
        <>
          <p className="muted">Salva da solo una copia dei dati nel tuo Google Drive, in una cartella riservata all’app. Così i dati restano anche se cancelli l’app o cambi telefono: basta ricollegare lo stesso account. <a href="./privacy.html">Privacy</a></p>
          <button className="btn primary" onClick={startDriveAuth}>
            Collega Google Drive
          </button>
        </>
      ) : (
        <>
          <p className={`alert ${token ? 'info' : 'warning'}`}>
            Ultimo salvataggio su Drive: <strong>{s.driveLastSyncAt ? `${formatDateShort(s.driveLastSyncAt.slice(0, 10))} ${s.driveLastSyncAt.slice(11, 16)} UTC` : 'mai'}</strong>.{' '}
            {token ? 'Ogni modifica viene salvata automaticamente quando c’è rete.' : 'L’accesso Google è scaduto: tocca Riconnetti per riprendere il salvataggio.'}
          </p>
          <div className="btn-group wrap">
            {token ? (
              <>
                <button className="btn primary" disabled={busy} onClick={() => run(async () => {
                  const m = await syncToDrive(token, s.driveLastSyncAt === null);
                  toast(m ? `Salvato su Drive (recuperate ${m.activities} attività)` : 'Salvato su Google Drive');
                })}>
                  Salva ora
                </button>
                <button className="btn" disabled={busy} onClick={() => run(async () => {
                  const m = await recoverFromDrive(token);
                  toast(m ? `Recuperate ${m.activities} attività da Drive (${m.skippedDuplicates} già presenti)` : 'Nessuna copia trovata su Drive');
                })}>
                  Recupera da Drive
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={startDriveAuth}>
                Riconnetti
              </button>
            )}
            <button className="btn ghost" disabled={busy} onClick={() => run(async () => {
              forgetDriveToken();
              await setSetting('driveSync', false);
              await setSetting('driveLastSyncAt', null);
              toast('Google Drive scollegato da questo dispositivo (la copia su Drive resta)');
            })}>
              Scollega
            </button>
          </div>
        </>
      )}
    </div>
  );
}
