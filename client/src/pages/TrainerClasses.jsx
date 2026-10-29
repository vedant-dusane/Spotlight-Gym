import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Roster from '../components/Roster.jsx';
import { Badge, ErrorNote, Spinner } from '../ui.jsx';
import { fmtDateTime } from '../utils.js';

export default function TrainerClasses() {
  const [classes, setClasses] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/trainer/classes').then((r) => setClasses(r.classes)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <h1>My classes</h1>
      <p className="muted">Showing the last 7 days and the next 14. Open a class once it has started to mark attendance.</p>
      <ErrorNote>{error}</ErrorNote>
      {!classes ? <Spinner /> : classes.length === 0 ? <p className="muted">No classes assigned.</p> : classes.map((c) => {
        const started = Date.parse(c.startsAt) <= Date.now();
        return (
          <article key={c.id} className="card">
            <div className="row-head">
              <div>
                <h3>{c.title}</h3>
                <p className="muted">{fmtDateTime(c.startsAt)} · {c.bookedCount}/{c.capacity} booked · {c.waitlistCount} waiting</p>
              </div>
              {c.status === 'cancelled' ? <Badge kind="bad">Cancelled</Badge> : <button className="btn" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Close' : started ? 'Mark attendance' : 'Roster'}</button>}
            </div>
            {open === c.id && <Roster classId={c.id} onSaved={load} />}
          </article>
        );
      })}
    </section>
  );
}
