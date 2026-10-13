import { describe, expect, it } from 'vitest';
import { backupNudge } from '../src/domain/backupNudge';

const now = new Date('2026-12-20T10:00:00Z');
const r = (updatedAt: string) => ({ updatedAt });

describe('promemoria backup', () => {
  it('nessun avviso senza dati', () => expect(backupNudge(null, [], now).show).toBe(false));
  it('avvisa se non è mai stato fatto un backup', () => expect(backupNudge(null, [r('2026-12-19T10:00:00Z')], now)).toMatchObject({ show: true, days: null, changes: 1 }));
  it('avvisa dopo 7 giorni solo se ci sono modifiche', () => {
    expect(backupNudge('2026-12-10T10:00:00Z', [r('2026-12-01T10:00:00Z')], now).show).toBe(false);
    expect(backupNudge('2026-12-10T10:00:00Z', [r('2026-12-11T10:00:00Z')], now)).toMatchObject({ show: true, days: 10, changes: 1 });
  });
  it('avvisa prima dei 7 giorni dopo molte modifiche', () => {
    const many = Array.from({ length: 15 }, () => r('2026-12-19T12:00:00Z'));
    expect(backupNudge('2026-12-19T10:00:00Z', many, now)).toMatchObject({ show: true, days: 1, changes: 15 });
    expect(backupNudge('2026-12-19T10:00:00Z', many.slice(1), now).show).toBe(false);
  });
});
