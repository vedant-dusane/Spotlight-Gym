import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { ErrorNote, Spinner } from '../ui.jsx';
import { fmtDateTime } from '../utils.js';

export default function Alerts() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/notifications/me').then((r) => setItems(r.notifications)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function readAll() { await api.post('/notifications/read-all'); load(); }

  return (
    <section>
      <div className="row-head"><h1>Alerts</h1>{items?.some((n) => !n.read) && <button className="btn btn-ghost" onClick={readAll}>Mark all read</button>}</div>
      <ErrorNote>{error}</ErrorNote>
      {!items ? <Spinner /> : items.length === 0 ? <p className="muted">No alerts yet. You will see waitlist promotions and membership reminders here.</p> : items.map((n) => (
        <article key={n.id} className={`card alert ${n.read ? '' : 'alert-new'}`}>
          <p>{n.message}</p><small className="muted">{fmtDateTime(n.createdAt)}</small>
        </article>
      ))}
    </section>
  );
}
