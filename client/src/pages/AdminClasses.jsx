import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import ClassForm from '../components/ClassForm.jsx';
import Roster from '../components/Roster.jsx';
import { Badge, ErrorNote, Spinner, Spots, useToast } from '../ui.jsx';
import { fmtDateTime } from '../utils.js';

export default function AdminClasses() {
  const toast = useToast();
  const [classes, setClasses] = useState(null);
  const [trainers, setTrainers] = useState([]);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(null); // {type:'new'} | {type:'edit'|'roster', id}

  const load = useCallback(async () => {
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 45 * 86_400_000).toISOString();
    try {
      const [c, t] = await Promise.all([api.get(`/classes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), api.get('/admin/trainers')]);
      setClasses(c.classes); setTrainers(t.trainers); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function cancelClass(c) {
    if (!window.confirm(`Cancel "${c.title}"? All ${c.bookedCount + c.waitlistCount} bookings will be cancelled and members notified.`)) return;
    try { await api.post(`/classes/${c.id}/cancel`); toast('Class cancelled.', 'success'); } catch (e) { toast(e.message, 'error'); } finally { load(); }
  }

  const done = () => { setPanel(null); load(); };

  return (
    <section>
      <div className="row-head"><h1>Class schedule</h1><button className="btn btn-primary" onClick={() => setPanel({ type: 'new' })}>+ New class</button></div>
      <ErrorNote>{error}</ErrorNote>
      {panel?.type === 'new' && trainers.length > 0 && <ClassForm trainers={trainers} onDone={done} onCancel={() => setPanel(null)} />}
      {!classes ? <Spinner /> : classes.length === 0 ? <p className="muted">No classes yet.</p> : classes.map((c) => {
        const started = Date.parse(c.startsAt) <= Date.now();
        return (
          <article key={c.id} className={`card ${c.status === 'cancelled' ? 'is-cancelled' : ''}`}>
            <div className="row-head">
              <div>
                <h3>{c.title} <small className="muted">with {c.trainerName}</small></h3>
                <p className="muted">{fmtDateTime(c.startsAt)} · {c.durationMinutes} min</p>
                <Spots booked={c.bookedCount} capacity={c.capacity} />
                <p className="small">{c.bookedCount}/{c.capacity} booked · {c.waitlistCount} waitlisted {c.status === 'cancelled' && <Badge kind="bad">Cancelled</Badge>}</p>
              </div>
              {c.status === 'scheduled' && (
                <div className="actions">
                  <button className="btn" onClick={() => setPanel(panel?.id === c.id && panel.type === 'roster' ? null : { type: 'roster', id: c.id })}>Roster</button>
                  {!started && <button className="btn" onClick={() => setPanel({ type: 'edit', id: c.id })}>Edit</button>}
                  {!started && <button className="btn btn-danger" onClick={() => cancelClass(c)}>Cancel</button>}
                </div>
              )}
            </div>
            {panel?.id === c.id && panel.type === 'edit' && <ClassForm trainers={trainers} existing={c} onDone={done} onCancel={() => setPanel(null)} />}
            {panel?.id === c.id && panel.type === 'roster' && <Roster classId={c.id} onSaved={load} />}
          </article>
        );
      })}
    </section>
  );
}
