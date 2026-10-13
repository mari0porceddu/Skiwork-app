import { useEffect, useId, useState, type ReactNode } from 'react';
import { centsToInput, parseEuroToCents } from '../../domain/money';

export function Field({ label, children, hint, error }: { label: string; children: (id: string) => ReactNode; hint?: string; error?: string | null }) {
  const id = useId();
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && !error && <small className="hint">{hint}</small>}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/** Input per importi in euro: memorizza centesimi interi. */
export function MoneyInput({ id, value, onChange, allowNegative = false }: { id: string; value: number | null; onChange: (cents: number | null) => void; allowNegative?: boolean }) {
  const [text, setText] = useState(value === null ? '' : centsToInput(value));
  useEffect(() => {
    const parsed = parseEuroToCents(text);
    if (parsed !== value) setText(value === null ? '' : centsToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="money-input">
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder="0,00"
        onChange={(e) => {
          setText(e.target.value);
          const c = parseEuroToCents(e.target.value);
          if (c === null || (!allowNegative && c < 0)) onChange(null);
          else onChange(c);
        }}
      />
      <span aria-hidden>€</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}
