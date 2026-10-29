import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l.slice(-3), { id, message, kind }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.message}</span>
            <button className="toast-x" aria-label="Dismiss" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** One dot per spot (filled = taken). Falls back to a bar for big classes. */
export function Spots({ booked, capacity }) {
  if (capacity > 24) {
    return (
      <div className="bar" role="img" aria-label={`${booked} of ${capacity} spots taken`}>
        <div className="bar-fill" style={{ width: `${Math.min(100, (booked / capacity) * 100)}%` }} />
      </div>
    );
  }
  return (
    <div className="spots" role="img" aria-label={`${booked} of ${capacity} spots taken`}>
      {Array.from({ length: capacity }, (_, i) => <span key={i} className={i < booked ? 'dot dot-on' : 'dot'} />)}
    </div>
  );
}

export const Badge = ({ kind = 'neutral', children }) => <span className={`badge badge-${kind}`}>{children}</span>;
export const Spinner = ({ label = 'Loading…' }) => <p className="muted" role="status">{label}</p>;
export const ErrorNote = ({ children }) => (children ? <p className="error" role="alert">{children}</p> : null);

export function Field({ label, error, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </label>
  );
}

/** Reloads on an interval so spot counts stay roughly live without websockets. */
export function usePolling(fn, ms = 30000) {
  useEffect(() => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }, [fn, ms]);
}
