import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import ClassCard from '../components/ClassCard.jsx';
import { ErrorNote, Spinner, useToast, usePolling } from '../ui.jsx';
import { addDaysLocal, dayKey, fmtDay } from '../utils.js';

export default function Schedule() {
  const toast = useToast();
  const [classes, setClasses] = useState(null);
  const [membership, setMembership] = useState(null);
  const [error, setError] = useState('');
  const [day, setDay] = useState(dayKey(new Date()));
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([api.get('/classes'), api.get('/memberships/me')]);
      setClasses(c.classes); setMembership(m); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 30000);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysLocal(new Date(), i)), []);
  const byDay = useMemo(() => {
    const m = {};
    (classes || []).forEach((c) => { (m[dayKey(c.startsAt)] ||= []).push(c); });
    return m;
  }, [classes]);

  async function book(c) {
    setBusyId(c.id);
    try {
      const r = await api.post(`/classes/${c.id}/bookings`);
      toast(r.message, r.status === 'booked' ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); } finally { setBusyId(null); load(); }
  }
  async function cancel(bookingId, isWaitlist) {
    if (!isWaitlist && !window.confirm('Cancel this booking? Your spot goes to the next person on the waitlist.')) return;
    try {
      const r = await api.del(`/bookings/${bookingId}`);
      toast(r.message, 'success');
    } catch (e) { toast(e.message, 'error'); } finally { load(); }
  }

  return (
    <section>
      <h1>Classes</h1>
      {membership && !membership.hasActive && (
        <div className="notice">You do not have an active membership, so booking is disabled. <Link to="/membership">Choose a plan</Link></div>
      )}
      {membership?.current && membership.current.daysLeft <= 7 && (
        <div className="notice notice-warn">Your {membership.current.planName} membership ends in {membership.current.daysLeft} day(s). <Link to="/membership">Renew</Link></div>
      )}
      <div className="days" role="tablist" aria-label="Pick a day">
        {days.map((d) => {
          const k = dayKey(d); const n = byDay[k]?.length || 0;
          return (
            <button key={k} role="tab" aria-selected={k === day} className={`day ${k === day ? 'day-on' : ''}`} onClick={() => setDay(k)}>
              <span>{d.toLocaleDateString([], { weekday: 'short' })}</span>
              <strong>{d.getDate()}</strong>
              <i>{n ? `${n} class${n > 1 ? 'es' : ''}` : '–'}</i>
            </button>
          );
        })}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!classes ? <Spinner /> : (
        <>
          <h2 className="day-title">{fmtDay(`${day}T12:00:00`)}</h2>
          {(byDay[day] || []).length === 0 ? <p className="muted">No classes this day.</p> :
            byDay[day].map((c) => <ClassCard key={c.id} c={c} busy={busyId === c.id} onBook={book} onCancel={cancel} />)}
        </>
      )}
    </section>
  );
}
