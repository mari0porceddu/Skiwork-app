import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  computeFiscal,
  FISCAL_PARAM_DEFS,
  FISCAL_PARAM_STATUS_LABEL,
  findParam,
  type FiscalDeadline,
  type FiscalParam,
  type FiscalParamDef,
  type FiscalParamStatus,
  type FiscalValues,
} from '../../domain/fiscal';
import { newId } from '../../domain/ids';
import { applyBps, formatBps, formatEuro, parsePercentToBps } from '../../domain/money';
import { formatDateShort, isValidDate, todayISO } from '../../domain/time';
import { db } from '../../db/db';
import { deleteRecord, saveRecord, setSetting } from '../../db/repo';
import { EmptyState, Field, MoneyInput } from '../components/fields';
import { Sheet } from '../components/Sheet';
import { useApp } from '../context';
import { fiscalClientIds, fiscalEstimate } from '../fiscalData';

export const FISCAL_NOT_CONFIGURED = 'Stima fiscale non configurata: verifica i parametri con il commercialista.';

/** Voci del profilo dichiarato: i valori li inserisce l'utente, nessuno è precompilato. */
const PROFILE_FIELDS = ['Regime fiscale', 'Codice ATECO', 'Partita IVA', 'Gestione previdenziale', 'Inquadramento delle prestazioni per committente', 'Altri redditi o coperture previdenziali', 'Commercialista', 'Note'];

function formatValue(def: FiscalParamDef, v: FiscalParam['value']): string {
  if (v === null || v === '') return '—';
  if (def.kind === 'percent') return formatBps(Number(v));
  if (def.kind === 'amount') return formatEuro(Number(v));
  if (def.kind === 'boolean') return v === 1 ? 'Sì' : 'No';
  return v === 'invoiced' ? 'Fatturati' : 'Incassati (cassa)';
}

export function Fiscal() {
  const { data, toast } = useApp();
  const today = todayISO();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [editing, setEditing] = useState<{ def: FiscalParamDef; clientId: string | null; param: FiscalParam | null } | null>(null);
  const [deadline, setDeadline] = useState<FiscalDeadline | null>(null);
  const [setAside, setSetAside] = useState(data.settings.manualSetAsideBps !== null ? String(data.settings.manualSetAsideBps / 100).replace('.', ',') : '');
  const est = fiscalEstimate(data, year);
  const clientIds = fiscalClientIds(data, est.inputs);
  const clientName = (id: string | null) => (id ? (data.clients.find((c) => c.id === id)?.name ?? '?') : 'Tutti i committenti');
  const defLabel = (k: string) => FISCAL_PARAM_DEFS.find((d) => d.key === k)?.label ?? k;
  const collectedYear = [...est.inputs.collectedByClient.values()].reduce((s, v) => s + v, 0);

  const rows = FISCAL_PARAM_DEFS.flatMap((def) => (def.perClient ? clientIds.map((c) => ({ def, clientId: c as string | null })) : [{ def, clientId: null as string | null }])).map((r) => ({
    ...r,
    param: findParam(data.fiscalParams, r.def.key, year, r.clientId),
  }));

  return (
    <div className="page">
      <header className="page-header">
        <h1>Fisco</h1>
        <label className="inline">
          Anno
          <select aria-label="Anno fiscale" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="card">
        <h2 className="card-title">Stima {year}</h2>
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Fatturato</span>
            <span className="stat-value">{formatEuro([...est.inputs.invoicedByClient.values()].reduce((s, v) => s + v, 0))}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Incassato</span>
            <span className="stat-value">{formatEuro(collectedYear)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Accantonato</span>
            <span className="stat-value">{formatEuro(est.inputs.setAsideCents)}</span>
          </div>
        </div>
        {est.result ? (
          <>
            <p className="alert info">Stima calcolata con parametri verificati per il {year}. È una stima: non sostituisce il commercialista.</p>
            <FiscalResultView r={est.result} />
          </>
        ) : (
          <>
            <p className="alert warning">{FISCAL_NOT_CONFIGURED}</p>
            <p className="small">Mancano o non sono verificati:</p>
            <ul className="small">
              {est.missing.map((m, i) => (
                <li key={i}>
                  {defLabel(m.key)}
                  {m.clientId ? ` (${clientName(m.clientId)})` : ''} —{' '}
                  {{ missing: 'non inserito', not_verified: 'da verificare', expired: 'scaduto', no_value: 'valore mancante', no_reason: 'manca la motivazione di “non applicabile”' }[m.reason]}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Accantonamento manuale</h2>
        <p className="muted small">Scelta prudenziale tua, non un calcolo fiscale. Vale anche senza parametri configurati.</p>
        <div className="inline">
          <input aria-label="Percentuale dell’incassato" inputMode="decimal" value={setAside} onChange={(e) => setSetAside(e.target.value)} placeholder="% dell’incassato, es. 25" />
          <button
            className="btn small"
            onClick={async () => {
              if (setAside.trim() === '') {
                await setSetting('manualSetAsideBps', null);
                return toast('Accantonamento manuale disattivato');
              }
              const bps = parsePercentToBps(setAside);
              if (bps === null || bps > 10000) return toast('Percentuale non valida', 'error');
              await setSetting('manualSetAsideBps', bps);
              toast('Accantonamento manuale salvato');
            }}
          >
            Salva
          </button>
        </div>
        {data.settings.manualSetAsideBps !== null && (
          <p className="small">
            {formatBps(data.settings.manualSetAsideBps)} di {formatEuro(collectedYear)} incassati nel {year} = <strong>{formatEuro(applyBps(collectedYear, data.settings.manualSetAsideBps))}</strong>
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Parametri {year}</h2>
        <p className="muted small">Inserisci solo valori verificati con il commercialista, con la fonte. Ogni modifica resta nello storico. Nessun valore è precompilato.</p>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>Parametro</th>
                <th>Valore</th>
                <th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ def, clientId, param }) => (
                <tr key={`${def.key}:${clientId}`} className="clickable" onClick={() => setEditing({ def, clientId, param: param && param.clientId === clientId ? param : null })}>
                  <td>
                    {def.label}
                    {def.perClient && <small className="muted"> · {clientName(clientId)}</small>}
                    {!def.required && <small className="muted"> (facoltativo)</small>}
                    {param?.source && (
                      <>
                        <br />
                        <small className="muted">Fonte: {param.source}</small>
                      </>
                    )}
                  </td>
                  <td>{param ? (param.status === 'not_applicable' ? 'n/a' : formatValue(def, param.value)) : '—'}</td>
                  <td>
                    <span className={`badge fiscal-${param?.status ?? 'none'}`}>{param ? FISCAL_PARAM_STATUS_LABEL[param.status] : 'Non inserito'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Simulation year={year} />

      <section className="card">
        <h2 className="card-title">
          Scadenze fiscali
          <button className="btn small" onClick={() => setDeadline({ id: newId(), date: today, title: '', amountCents: null, notes: '', done: false, createdAt: '', updatedAt: '' })}>
            Aggiungi
          </button>
        </h2>
        <p className="muted small">Inserisci le scadenze indicate dal commercialista: compaiono nei promemoria. SkiWork non contiene un calendario fiscale predefinito.</p>
        {data.fiscalDeadlines.length === 0 ? (
          <EmptyState title="Nessuna scadenza" />
        ) : (
          <ul className="rules">
            {data.fiscalDeadlines.map((f) => (
              <li key={f.id}>
                <button className="rule" onClick={() => setDeadline(f)}>
                  <span className={`badge ${f.done ? 'completed' : f.date < today ? 'cancelled' : 'planned'}`}>{f.done ? 'Fatto' : f.date < today ? 'Scaduta' : 'Da fare'}</span>
                  <strong>{formatDateShort(f.date)}</strong> {f.title}
                  {f.amountCents !== null && <span>{formatEuro(f.amountCents)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeclaredProfile />

      {editing && <ParamEditor year={year} {...editing} clientName={clientName(editing.clientId)} onClose={() => setEditing(null)} />}
      {deadline && <DeadlineEditor d={deadline} onClose={() => setDeadline(null)} />}
    </div>
  );
}

function FiscalResultView({ r, simulated = false }: { r: ReturnType<typeof computeFiscal>; simulated?: boolean }) {
  return (
    <>
      <div className="stats">
        {(
          [
            ['Reddito imponibile', r.taxableIncomeCents],
            ['Contributi', r.contributionsCents],
            ['Imposta sostitutiva', r.substituteTaxCents],
            ['Saldo imposta', r.balanceDueCents],
            ['Acconti anno successivo', r.advancesNextYearCents],
            ['Accantonamento suggerito', r.suggestedSetAsideCents],
            ['Da accantonare ancora', r.setAsideGapCents],
            ['Liquidità residua', r.residualLiquidityCents],
          ] as [string, number][]
        ).map(([l, v]) => (
          <div key={l} className="stat">
            <span className="stat-label">
              {l}
              {simulated ? ' (sim.)' : ''}
            </span>
            <span className="stat-value">{formatEuro(v)}</span>
          </div>
        ))}
      </div>
      <details className="advanced">
        <summary>Dettaglio del calcolo</summary>
        <table className="table compact">
          <tbody>
            {r.steps.map((s, i) => (
              <tr key={i}>
                <td>
                  {s.label}
                  <br />
                  <small className="muted">{s.formula}</small>
                </td>
                <td className="num">{formatEuro(s.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function Simulation({ year }: { year: number }) {
  const { data } = useApp();
  const est = fiscalEstimate(data, year);
  const clientIds = fiscalClientIds(data, est.inputs);
  const pv = (k: FiscalParam['key'], c: string | null = null) => findParam(data.fiscalParams, k, year, c)?.value ?? null;
  const pct = (v: unknown) => (typeof v === 'number' ? String(v / 100).replace('.', ',') : '');
  const [s, setS] = useState(() => ({
    basis: (pv('revenue_basis') as string) === 'invoiced' ? 'invoiced' : 'collected',
    coef: pct(pv('profitability_coefficient')),
    tax: pct(pv('substitute_tax_rate')),
    adv: pct(pv('advance_rate')),
    deduct: pv('deduct_contributions') === 1,
    paid: (pv('contributions_paid') as number | null) ?? 0,
    contrib: Object.fromEntries(clientIds.map((c) => [c, pct(pv('contribution_rate', c))])) as Record<string, string>,
  }));
  const names = new Map(data.clients.map((c) => [c.id, c.name]));
  const result = useMemo(() => {
    const coef = parsePercentToBps(s.coef);
    const tax = parsePercentToBps(s.tax);
    const adv = parsePercentToBps(s.adv);
    if (!s.coef || !s.tax || coef === null || tax === null || adv === null) return null;
    const contrib = new Map<string, number | null>();
    for (const c of clientIds) {
      const v = s.contrib[c] ?? '';
      contrib.set(c, v.trim() === '' ? null : parsePercentToBps(v));
    }
    const values: FiscalValues = { revenueBasis: s.basis as FiscalValues['revenueBasis'], profitabilityBps: coef, substituteTaxBps: tax, contributionBpsByClient: contrib, contributionFixedCents: 0, deductContributions: s.deduct, contributionsPaidCents: s.paid, advanceBps: adv, advancesPaidCents: 0 };
    return computeFiscal(est.inputs, values, (id) => names.get(id) ?? id);
  }, [s, est.inputs, clientIds, names]);

  return (
    <section className="card">
      <h2 className="card-title">Simulazione di scenari</h2>
      <p className="alert warning small">Simulazione con valori a tua scelta: non è una stima e non viene salvata. Utile per confrontare scenari con il commercialista.</p>
      <div className="form">
        <div className="row2">
          <Field label="Base dei ricavi">
            {(id) => (
              <select id={id} value={s.basis} onChange={(e) => setS({ ...s, basis: e.target.value })}>
                <option value="collected">Incassati (cassa)</option>
                <option value="invoiced">Fatturati</option>
              </select>
            )}
          </Field>
          <Field label="Coefficiente di redditività %">{(id) => <input id={id} inputMode="decimal" value={s.coef} onChange={(e) => setS({ ...s, coef: e.target.value })} />}</Field>
        </div>
        <div className="row2">
          <Field label="Aliquota imposta %">{(id) => <input id={id} inputMode="decimal" value={s.tax} onChange={(e) => setS({ ...s, tax: e.target.value })} />}</Field>
          <Field label="Acconti anno successivo %">{(id) => <input id={id} inputMode="decimal" value={s.adv} onChange={(e) => setS({ ...s, adv: e.target.value })} placeholder="0" />}</Field>
        </div>
        <div className="row2">
          {clientIds.map((c) => (
            <Field key={c} label={`Aliquota contributiva % · ${names.get(c) ?? c}`} hint="Vuoto = non applicabile">
              {(id) => <input id={id} inputMode="decimal" value={s.contrib[c] ?? ''} onChange={(e) => setS({ ...s, contrib: { ...s.contrib, [c]: e.target.value } })} />}
            </Field>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={s.deduct} onChange={(e) => setS({ ...s, deduct: e.target.checked })} /> Deduci i contributi versati
        </label>
        {s.deduct && <Field label="Contributi versati nell’anno">{(id) => <MoneyInput id={id} value={s.paid} onChange={(v) => setS({ ...s, paid: v ?? 0 })} />}</Field>}
      </div>
      {result ? <FiscalResultView r={result} simulated /> : <p className="muted small">Inserisci almeno coefficiente e aliquota per vedere la simulazione.</p>}
    </section>
  );
}

function ParamEditor({ def, clientId, param, year, clientName, onClose }: { def: FiscalParamDef; clientId: string | null; param: FiscalParam | null; year: number; clientName: string; onClose: () => void }) {
  const { toast, confirm } = useApp();
  const today = todayISO();
  const [p, setP] = useState<FiscalParam>(
    param ?? { id: newId(), key: def.key, year, clientId, value: def.kind === 'choice' ? 'collected' : null, status: 'to_verify', statusReason: '', source: '', validFrom: null, validTo: null, lastVerifiedAt: null, createdAt: '', updatedAt: '' },
  );
  const [text, setText] = useState(def.kind === 'percent' && typeof p.value === 'number' ? String(p.value / 100).replace('.', ',') : '');
  const [error, setError] = useState<string | null>(null);
  const history = useLiveQuery(() => db.audit.where('entityId').equals(p.id).reverse().sortBy('at'), [p.id]);
  const set = (x: Partial<FiscalParam>) => setP((o) => ({ ...o, ...x }));

  async function save() {
    let value = p.value;
    if (def.kind === 'percent') {
      if (text.trim() === '') value = null;
      else {
        const bps = parsePercentToBps(text);
        if (bps === null || bps > 10000) return setError('Percentuale non valida');
        value = bps;
      }
    }
    if (p.status === 'verified' && (value === null || value === '')) return setError('Un parametro verificato deve avere un valore');
    if (p.status === 'verified' && p.source.trim() === '') return setError('Indica la fonte della verifica');
    if (p.status === 'not_applicable' && p.statusReason.trim() === '') return setError('Indica perché non è applicabile');
    for (const d of [p.validFrom, p.validTo, p.lastVerifiedAt]) if (d && !isValidDate(d)) return setError('Data non valida');
    let reason = '';
    if (param && JSON.stringify(param.value) !== JSON.stringify(value)) {
      const r = await confirm({ title: 'Modifica di un parametro fiscale', message: 'La modifica resta nello storico.', confirmLabel: 'Salva', reasonLabel: 'Motivazione' });
      if (!r.ok) return;
      reason = r.reason;
    }
    await saveRecord('fiscalParams', { ...p, value, lastVerifiedAt: p.status === 'verified' ? (p.lastVerifiedAt ?? today) : p.lastVerifiedAt }, reason);
    toast('Parametro salvato');
    onClose();
  }

  return (
    <Sheet
      open
      title={`${def.label}${def.perClient ? ` · ${clientName}` : ''} · ${year}`}
      onClose={onClose}
      footer={
        <>
          {param && (
            <button
              className="btn danger ghost"
              onClick={async () => {
                const r = await confirm({ title: 'Eliminare il parametro?', message: 'La stima tornerà non configurata se il parametro è necessario.', confirmLabel: 'Elimina', danger: true, reasonLabel: 'Motivazione' });
                if (!r.ok) return;
                await deleteRecord('fiscalParams', p.id, r.reason);
                onClose();
              }}
            >
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
        <p className="muted small">{def.help}</p>
        {def.kind === 'percent' && <Field label="Valore %">{(id) => <input id={id} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />}</Field>}
        {def.kind === 'amount' && <Field label="Importo">{(id) => <MoneyInput id={id} value={typeof p.value === 'number' ? p.value : null} onChange={(v) => set({ value: v })} />}</Field>}
        {def.kind === 'boolean' && (
          <label className="check">
            <input type="checkbox" checked={p.value === 1} onChange={(e) => set({ value: e.target.checked ? 1 : 0 })} /> Sì
          </label>
        )}
        {def.kind === 'choice' && (
          <Field label="Valore">
            {(id) => (
              <select id={id} value={String(p.value ?? 'collected')} onChange={(e) => set({ value: e.target.value })}>
                <option value="collected">Incassati (cassa)</option>
                <option value="invoiced">Fatturati</option>
              </select>
            )}
          </Field>
        )}
        <Field label="Stato di verifica">
          {(id) => (
            <select id={id} value={p.status} onChange={(e) => set({ status: e.target.value as FiscalParamStatus })}>
              {(Object.keys(FISCAL_PARAM_STATUS_LABEL) as FiscalParamStatus[]).map((s) => (
                <option key={s} value={s}>
                  {FISCAL_PARAM_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {p.status === 'not_applicable' && <Field label="Motivazione">{(id) => <input id={id} value={p.statusReason} onChange={(e) => set({ statusReason: e.target.value })} />}</Field>}
        <Field label="Fonte o documento di riferimento">{(id) => <input id={id} value={p.source} onChange={(e) => set({ source: e.target.value })} placeholder="es. email del commercialista del 10/10" />}</Field>
        <div className="row3">
          <Field label="Verificato il">{(id) => <input id={id} type="date" value={p.lastVerifiedAt ?? ''} onChange={(e) => set({ lastVerifiedAt: e.target.value || null })} />}</Field>
          <Field label="Valido dal">{(id) => <input id={id} type="date" value={p.validFrom ?? ''} onChange={(e) => set({ validFrom: e.target.value || null })} />}</Field>
          <Field label="Valido al">{(id) => <input id={id} type="date" value={p.validTo ?? ''} onChange={(e) => set({ validTo: e.target.value || null })} />}</Field>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {history && history.length > 0 && (
          <details className="advanced">
            <summary>Storico modifiche ({history.length})</summary>
            <ul className="audit">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="muted small">{new Date(h.at).toLocaleString('it-IT')}</span> {h.action}{' '}
                  <span className="small">
                    {Object.entries(h.changes)
                      .filter(([k]) => ['value', 'status', 'source'].includes(k))
                      .map(([k, c]) => `${k}: ${JSON.stringify(c.from ?? null)} → ${JSON.stringify(c.to ?? null)}`)
                      .join('; ')}
                  </span>
                  {h.reason && <em className="small"> — {h.reason}</em>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Sheet>
  );
}

function DeadlineEditor({ d, onClose }: { d: FiscalDeadline; onClose: () => void }) {
  const { data, toast, confirm } = useApp();
  const [x, setX] = useState(d);
  const [error, setError] = useState<string | null>(null);
  const exists = data.fiscalDeadlines.some((f) => f.id === d.id);
  async function save() {
    if (!isValidDate(x.date)) return setError('Data non valida');
    if (x.title.trim() === '') return setError('Inserisci una descrizione');
    await saveRecord('fiscalDeadlines', { ...x, title: x.title.trim() });
    toast('Scadenza salvata');
    onClose();
  }
  return (
    <Sheet
      open
      title={exists ? 'Scadenza fiscale' : 'Nuova scadenza fiscale'}
      onClose={onClose}
      footer={
        <>
          {exists && (
            <button
              className="btn danger ghost"
              onClick={async () => {
                if (!(await confirm({ title: 'Eliminare la scadenza?', message: x.title, confirmLabel: 'Elimina', danger: true })).ok) return;
                await deleteRecord('fiscalDeadlines', x.id);
                onClose();
              }}
            >
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
        <Field label="Descrizione">{(id) => <input id={id} value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} placeholder="es. Saldo e primo acconto" />}</Field>
        <div className="row2">
          <Field label="Data">{(id) => <input id={id} type="date" value={x.date} onChange={(e) => setX({ ...x, date: e.target.value })} />}</Field>
          <Field label="Importo previsto (facoltativo)">{(id) => <MoneyInput id={id} value={x.amountCents} onChange={(v) => setX({ ...x, amountCents: v })} />}</Field>
        </div>
        <Field label="Note">{(id) => <textarea id={id} rows={2} value={x.notes} onChange={(e) => setX({ ...x, notes: e.target.value })} />}</Field>
        <label className="check">
          <input type="checkbox" checked={x.done} onChange={(e) => setX({ ...x, done: e.target.checked })} /> Completata
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

function DeclaredProfile() {
  const { data, toast } = useApp();
  const [p, setP] = useState(data.settings.fiscalProfile);
  const statuses = ['', 'Dichiarato', 'Da verificare', 'Verificato', 'Non applicabile'];
  const save = async () => {
    await setSetting('fiscalProfile', p);
    toast('Profilo salvato');
  };
  return (
    <section className="card">
      <h2 className="card-title">
        Profilo dichiarato
        <button className="btn small" onClick={save}>
          Salva
        </button>
      </h2>
      <p className="muted small">Promemoria della tua situazione, salvato solo sul dispositivo. Non entra nei calcoli: la stima usa solo i parametri verificati qui sopra.</p>
      <div className="form">
        {PROFILE_FIELDS.map((f) => (
          <div key={f} className="row2">
            <Field label={f}>{(id) => <input id={id} value={p[f]?.value ?? ''} onChange={(e) => setP({ ...p, [f]: { value: e.target.value, status: p[f]?.status ?? '' } })} />}</Field>
            <Field label="Stato">
              {(id) => (
                <select id={id} value={p[f]?.status ?? ''} onChange={(e) => setP({ ...p, [f]: { value: p[f]?.value ?? '', status: e.target.value } })}>
                  {statuses.map((x) => (
                    <option key={x} value={x}>
                      {x || '—'}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        ))}
      </div>
    </section>
  );
}
