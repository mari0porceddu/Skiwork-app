import { computeActivity } from '../../domain/compensation';
import { formatEuro } from '../../domain/money';
import { SHIFT_LABEL } from '../../domain/shifts';
import { crossesMidnight, formatDateLong, formatMinutesAsHours } from '../../domain/time';
import { ACTIVITY_STATUS_LABEL, ACTIVITY_TYPE_LABEL, isWorkType, type Activity, type Client } from '../../domain/types';

export function ActivityRow({ a, client, onOpen, showDate = false }: { a: Activity; client?: Client; onOpen: () => void; showDate?: boolean }) {
  const c = computeActivity(a);
  const amount = a.status === 'completed' || a.status === 'cancelled' ? c.accruedCents : c.expectedCents;
  return (
    <button type="button" className={`activity-row status-${a.status}`} onClick={onOpen} style={{ borderLeftColor: client?.color ?? 'var(--muted)' }}>
      <span className="ar-time">
        {showDate && <span className="ar-date">{formatDateLong(a.date)}</span>}
        {a.start}–{a.end}
        {crossesMidnight(a.start, a.end) ? ' (+1)' : ''}
      </span>
      <span className="ar-main">
        <span className="ar-title">{a.title || ACTIVITY_TYPE_LABEL[a.type]}</span>
        <span className="ar-sub">
          {[client?.name, a.shift ? SHIFT_LABEL[a.shift] : null, a.title ? ACTIVITY_TYPE_LABEL[a.type] : null, a.location].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="ar-right">
        <span className={`badge ${a.status}`}>{ACTIVITY_STATUS_LABEL[a.status]}</span>
        {isWorkType(a.type) && (a.rate || amount !== 0) && (
          <span className={`ar-amount ${a.status === 'completed' ? '' : 'muted'}`} title={a.status === 'completed' ? 'Maturato' : 'Previsto'}>
            {formatEuro(amount)}
          </span>
        )}
        {a.status !== 'cancelled' && <span className="ar-hours muted">{formatMinutesAsHours(a.status === 'completed' ? c.workedMinutes : c.plannedMinutes)}</span>}
      </span>
    </button>
  );
}
