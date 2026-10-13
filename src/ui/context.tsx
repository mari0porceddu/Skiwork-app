import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Activity } from '../domain/types';
import type { AppData } from './data';
import { Sheet } from './components/Sheet';

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

export interface DrillSpec {
  title: string;
  activityIds?: string[];
  documentIds?: string[];
  paymentIds?: string[];
  ledgerIds?: string[];
}

interface ConfirmSpec {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** Se presente, chiede una motivazione obbligatoria. */
  reasonLabel?: string;
  resolve: (r: { ok: boolean; reason: string }) => void;
}

export interface ActivityFormRequest {
  activity?: Activity;
  /** Precompilazioni per una nuova attività */
  date?: string;
  start?: string;
  end?: string;
}

interface Ctx {
  data: AppData;
  toast: (text: string, kind?: Toast['kind']) => void;
  confirm: (spec: Omit<ConfirmSpec, 'resolve'>) => Promise<{ ok: boolean; reason: string }>;
  drill: (spec: DrillSpec) => void;
  openActivity: (req?: ActivityFormRequest) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fuori dal provider');
  return c;
}

export function AppProvider({
  data,
  children,
  renderDrill,
  renderActivityForm,
}: {
  data: AppData;
  children: ReactNode;
  renderDrill: (spec: DrillSpec, close: () => void) => ReactNode;
  renderActivityForm: (req: ActivityFormRequest, close: () => void) => ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const [reason, setReason] = useState('');
  const [drillSpec, setDrillSpec] = useState<DrillSpec | null>(null);
  const [formReq, setFormReq] = useState<ActivityFormRequest | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2500);
  }, []);

  const confirm = useCallback(
    (spec: Omit<ConfirmSpec, 'resolve'>) =>
      new Promise<{ ok: boolean; reason: string }>((resolve) => {
        setReason('');
        setConfirmSpec({ ...spec, resolve });
      }),
    [],
  );

  const ctx = useMemo<Ctx>(() => ({ data, toast, confirm, drill: setDrillSpec, openActivity: (r = {}) => setFormReq(r) }), [data, toast, confirm]);

  const closeConfirm = (ok: boolean) => {
    confirmSpec?.resolve({ ok, reason: reason.trim() });
    setConfirmSpec(null);
  };

  return (
    <AppCtx.Provider value={ctx}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.text}
          </div>
        ))}
      </div>
      <Sheet
        open={confirmSpec !== null}
        title={confirmSpec?.title ?? ''}
        onClose={() => closeConfirm(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => closeConfirm(false)}>
              Annulla
            </button>
            <button
              type="button"
              className={`btn ${confirmSpec?.danger ? 'danger' : 'primary'}`}
              disabled={!!confirmSpec?.reasonLabel && reason.trim() === ''}
              onClick={() => closeConfirm(true)}
            >
              {confirmSpec?.confirmLabel}
            </button>
          </>
        }
      >
        <p>{confirmSpec?.message}</p>
        {confirmSpec?.reasonLabel && (
          <div className="field">
            <label htmlFor="confirm-reason">{confirmSpec.reasonLabel}</label>
            <input id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
        )}
      </Sheet>
      {drillSpec && renderDrill(drillSpec, () => setDrillSpec(null))}
      {formReq && renderActivityForm(formReq, () => setFormReq(null))}
    </AppCtx.Provider>
  );
}
