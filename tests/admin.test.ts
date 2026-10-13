import { describe, expect, it } from 'vitest';
import { computeDueDate, documentBalance, documentStatus } from '../src/domain/documents';
import { computeReminders } from '../src/domain/reminders';
import { goalCurrentValue, goalProgress } from '../src/domain/goals';
import { validateBackup, BACKUP_APP } from '../src/domain/backup';
import { toCsv } from '../src/domain/csv';
import { activity, client, doc, goal, payment } from './fixtures';

describe('documenti e pagamenti', () => {
  it('i documenti scaduti vengono identificati correttamente', () => {
    const d = doc({ dueDate: '2026-03-02' });
    expect(documentStatus(d, [], '2026-03-02')).toBe('issued');
    expect(documentStatus(d, [], '2026-03-03')).toBe('overdue');
    expect(documentStatus(d, [payment({ amountCents: 100000 })], '2026-04-01')).toBe('paid');
    expect(documentStatus(doc({ status: 'to_issue' }), [], '2027-01-01')).toBe('to_issue');
  });

  it('i pagamenti aggiornano i saldi', () => {
    const d = doc();
    expect(documentStatus(d, [payment()], '2026-02-15')).toBe('partially_paid');
    expect(documentBalance(d, [payment(), payment({ id: 'p2', amountCents: 10000 })])).toBe(50000);
    expect(documentBalance(d, [payment({ documentId: 'other' })])).toBe(100000);
  });

  it('le scadenze utilizzano le regole configurate per committente', () => {
    expect(computeDueDate('2026-01-31', { paymentTermsDays: 30 })).toBe('2026-03-02');
    expect(computeDueDate('2026-01-31', { paymentTermsDays: 0 })).toBe('2026-01-31');
    expect(computeDueDate('2026-01-31', { paymentTermsDays: null })).toBeNull();
  });
});

describe('promemoria', () => {
  const now = { date: '2026-01-10', time: '08:00' };
  it('genera promemoria con ID stabili e senza duplicati', () => {
    const input = {
      activities: [activity({ status: 'planned', start: '10:00', end: '11:00' }), activity({ id: 'old', date: '2026-01-09', status: 'confirmed' })],
      documents: [doc({ id: 'late', dueDate: '2026-01-05' }), doc({ id: 'todo', status: 'to_issue' })],
      payments: [],
      clients: [client()],
    };
    const a = computeReminders(input, now);
    const b = computeReminders(input, now);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(new Set(a.map((r) => r.id)).size).toBe(a.length);
    const cats = a.map((r) => r.category).sort();
    expect(cats).toEqual(['document_todo', 'overdue', 'to_complete', 'unconfirmed', 'upcoming'].sort());
  });

  it('le categorie disattivate non generano promemoria', () => {
    const r = computeReminders(
      { activities: [activity({ status: 'planned', start: '10:00' })], documents: [], payments: [], clients: [] },
      now,
      { enabled: { upcoming: false, unconfirmed: false, conflict: true, to_complete: true, document_todo: true, payment_due: true, overdue: true, fiscal_deadline: true }, upcomingHours: 24, paymentDueDays: 7, fiscalDueDays: 14 },
    );
    expect(r).toEqual([]);
  });
});

describe('obiettivi', () => {
  it('conta solo i dati consuntivi e calcola ritmo e previsione', () => {
    const acts = [
      activity({ id: 'a', date: '2026-01-02' }), // 2 h completate
      activity({ id: 'b', date: '2026-01-04', status: 'planned' }), // non conta
      activity({ id: 'c', date: '2026-01-05', type: 'training' }), // altra metrica
    ];
    const g = goal({ target: 600, periodFrom: '2026-01-01', periodTo: '2026-01-10' });
    const cur = goalCurrentValue(g, acts, [], '2026-01-05');
    expect(cur).toBe(120);
    const p = goalProgress(g, cur, '2026-01-05');
    expect(p.remaining).toBe(480);
    expect(p.pct).toBe(20);
    expect(p.daysElapsed).toBe(5);
    expect(p.daysLeft).toBe(5);
    expect(p.requiredPerDay).toBe(96);
    expect(p.projected).toBe(240);
    expect(p.status).toBe('behind');
    expect(p.forecastDate).toBe('2026-01-25');
  });

  it('guadagno maturato, incassato e giorni liberi', () => {
    const g = goal({ metric: 'accrued', target: 100000, clientId: 'school' });
    expect(goalCurrentValue(g, [activity(), activity({ id: 'x', clientId: 'asd' })], [], '2026-01-31')).toBe(10000);
    expect(goalCurrentValue({ ...g, metric: 'collected' }, [], [payment({ date: '2026-01-05' })], '2026-01-31')).toBe(40000);
    expect(goalCurrentValue({ ...g, metric: 'free_days' }, [activity({ date: '2026-01-03' })], [], '2026-01-05')).toBe(4);
    expect(goalCurrentValue({ ...g, metric: 'worked_days' }, [activity({ date: '2026-01-03' }), activity({ id: 'z', date: '2026-01-03' })], [], '2026-01-05')).toBe(1);
  });
});

describe('backup', () => {
  const base = {
    app: BACKUP_APP,
    formatVersion: 1,
    dbVersion: 1,
    exportedAt: '2026-01-01T00:00:00Z',
    tables: { clients: [client()], rates: [], activities: [activity()], availability: [], ledger: [], documents: [doc()], payments: [payment()], goals: [], audit: [], settings: [] },
  };
  it('accetta un backup valido', () => {
    expect(validateBackup(base)).toMatchObject({ ok: true });
  });
  it('rifiuta file non validi o con riferimenti incoerenti', () => {
    expect(validateBackup({ foo: 1 }).ok).toBe(false);
    expect(validateBackup({ ...base, tables: { ...base.tables, activities: [activity({ clientId: 'ghost' })] } }).errors[0]).toContain('committente inesistente');
    expect(validateBackup({ ...base, tables: { ...base.tables, activities: [activity({ start: '25:00' })] } }).ok).toBe(false);
    expect(validateBackup({ ...base, tables: { ...base.tables, payments: [payment({ amountCents: 10.5 })] } }).ok).toBe(false);
    expect(validateBackup({ ...base, tables: { ...base.tables, clients: [client(), client()] } }).errors[0]).toContain('duplicato');
  });
});

describe('CSV', () => {
  it('esegue escaping e protegge dalle formule', () => {
    const csv = toCsv(['a', 'b'], [['x;y', '=SUM(A1)'], ['-12,50', 'ok "q"']]);
    expect(csv).toContain('"x;y";\'=SUM(A1)');
    expect(csv).toContain('-12,50;"ok ""q"""');
  });
});

describe('scadenze fiscali', () => {
  it('genera promemoria solo per scadenze configurate, non completate ed entro l’anticipo', () => {
    const mk = (id: string, date: string, done = false) => ({ id, date, title: `Scadenza ${id}`, amountCents: null, notes: '', done, createdAt: '', updatedAt: '' });
    const r = computeReminders({ activities: [], documents: [], payments: [], clients: [], fiscalDeadlines: [mk('a', '2026-01-15'), mk('b', '2026-03-01'), mk('c', '2026-01-12', true), mk('d', '2026-01-05')] }, { date: '2026-01-10', time: '08:00' });
    expect(r.map((x) => x.ref.id)).toEqual(['d', 'a']);
    expect(r[0]?.severity).toBe('danger');
  });
});
