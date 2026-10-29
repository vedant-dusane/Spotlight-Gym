import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, ErrorNote, Spinner, useToast } from '../ui.jsx';

/** Roster + attendance marking for one class. Used by trainers (their classes) and admins. */
export default function Roster({ classId, onSaved }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [marks, setMarks] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/classes/${classId}/roster`).then((r) => {
      if (!live) return;
      setData(r);
      setMarks(Object.fromEntries(r.entries.filter((e) => e.status === 'attended' || e.status === 'no_show').map((e) => [e.bookingId, e.status])));
    }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [classId]);

  async function save() {
    const records = Object.entries(marks).map(([bookingId, status]) => ({ bookingId: Number(bookingId), status }));
    if (!records.length) { setError('Mark at least one member first.'); return; }
    setSaving(true); setError('');
    try {
      await api.put(`/classes/${classId}/attendance`, { records });
      toast('Attendance saved.', 'success');
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner />;
  const confirmed = data.entries.filter((e) => e.status !== 'waitlisted');
  const waitlist = data.entries.filter((e) => e.status === 'waitlisted');

  return (
    <div className="roster">
      <h4>Confirmed ({confirmed.length}/{data.class.capacity})</h4>
      {confirmed.length === 0 ? <p className="muted">Nobody booked yet.</p> : (
        <ul className="plain">
          {confirmed.map((e) => (
            <li key={e.bookingId} className="roster-row">
              <span>{e.name}<small className="muted"> {e.email}</small></span>
              {data.canMarkAttendance ? (
                <span className="seg" role="group" aria-label={`Attendance for ${e.name}`}>
                  <button type="button" className={marks[e.bookingId] === 'attended' ? 'seg-on seg-good' : ''} onClick={() => setMarks({ ...marks, [e.bookingId]: 'attended' })}>Present</button>
                  <button type="button" className={marks[e.bookingId] === 'no_show' ? 'seg-on seg-bad' : ''} onClick={() => setMarks({ ...marks, [e.bookingId]: 'no_show' })}>No-show</button>
                </span>
              ) : <Badge>{e.status.replace('_', ' ')}</Badge>}
            </li>
          ))}
        </ul>
      )}
      {waitlist.length > 0 && (
        <>
          <h4>Waitlist ({waitlist.length})</h4>
          <ol className="plain">{waitlist.map((e) => <li key={e.bookingId}>#{e.waitlistPosition} {e.name}</li>)}</ol>
        </>
      )}
      {!data.canMarkAttendance && <p className="muted small">Attendance can be marked once the class has started.</p>}
      <ErrorNote>{error}</ErrorNote>
      {data.canMarkAttendance && confirmed.length > 0 && <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save attendance'}</button>}
    </div>
  );
}
