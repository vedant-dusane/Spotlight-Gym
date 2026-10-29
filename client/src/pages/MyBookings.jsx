import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, ErrorNote, Spinner, useToast } from '../ui.jsx';
import { fmtDateTime } from '../utils.js';

const LABEL = { booked: ['Booked', 'good'], waitlisted: ['Waitlist', 'warn'], attended: ['Attended', 'good'], no_show: ['No-show', 'bad'] };

export default function MyBookings() {
  const { user } = useAuth();
  const toast = useToast();
  const [scope, setScope] = useState('upcoming');
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows((await api.get(`/bookings/me?scope=${scope}`)).bookings);
      setStats((await api.get(`/reports/members/${user.id}`)).totals);
      setError('');
    } catch (e) { setError(e.message); }
  }, [scope, user.id]);
  useEffect(() => { setRows(null); load(); }, [load]);

  async function cancel(b) {
    if (b.status === 'booked' && !window.confirm('Cancel this booking?')) return;
    try { toast((await api.del(`/bookings/${b.id}`)).message, 'success'); } catch (e) { toast(e.message, 'error'); } finally { load(); }
  }

  return (
    <section>
      <h1>My bookings</h1>
      {stats && (
        <div className="stats">
          <div><strong>{stats.attended}</strong><span>attended</span></div>
          <div><strong>{stats.noShow}</strong><span>no-shows</span></div>
          <div><strong>{stats.attendanceRate == null ? '–' : `${stats.attendanceRate}%`}</strong><span>attendance (last 90 days)</span></div>
        </div>
      )}
      <div className="tabs">
        {['upcoming', 'past'].map((s) => <button key={s} className={scope === s ? 'tab tab-on' : 'tab'} onClick={() => setScope(s)}>{s === 'upcoming' ? 'Upcoming' : 'Past'}</button>)}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!rows ? <Spinner /> : rows.length === 0 ? <p className="muted">Nothing here yet.</p> : rows.map((b) => (
        <article key={b.id} className="card row">
          <div>
            <h3>{b.title}</h3>
            <p className="muted">{fmtDateTime(b.startsAt)} · {b.trainerName}</p>
            <Badge kind={LABEL[b.status][1]}>{LABEL[b.status][0]}{b.waitlistPosition ? ` #${b.waitlistPosition}` : ''}</Badge>
            {b.classStatus === 'cancelled' && <> <Badge kind="bad">Class cancelled</Badge></>}
          </div>
          {scope === 'upcoming' && (b.canCancel
            ? <button className="btn btn-danger" onClick={() => cancel(b)}>{b.status === 'waitlisted' ? 'Leave' : 'Cancel'}</button>
            : <small className="muted">Cancellation closed</small>)}
        </article>
      ))}
    </section>
  );
}
