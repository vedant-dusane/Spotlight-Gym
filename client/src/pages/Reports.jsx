import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, ErrorNote, Spinner } from '../ui.jsx';
import { fmtDateTime, fmtYmd } from '../utils.js';

const KIND = { attended: 'good', no_show: 'bad', booked: 'warn', cancelled: 'neutral', waitlisted: 'warn' };

export default function Reports() {
  const [report, setReport] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/reports/members').then(setReport).catch((e) => setError(e.message)); }, []);

  async function open(id) {
    try { setDetail(await api.get(`/reports/members/${id}`)); } catch (e) { setError(e.message); }
  }

  return (
    <section>
      <h1>Attendance report</h1>
      {report && <p className="muted">Classes from {fmtYmd(report.from)} to {fmtYmd(report.to)}. Tap a member for their history.</p>}
      <ErrorNote>{error}</ErrorNote>
      {!report ? <Spinner /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Member</th><th>Attended</th><th>No-show</th><th>Unmarked</th><th>Cancelled</th><th>Rate</th></tr></thead>
            <tbody>
              {report.members.map((m) => (
                <tr key={m.id} onClick={() => open(m.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(m.id)} className="clickable">
                  <td>{m.name}</td><td>{m.attended}</td><td>{m.noShow}</td><td>{m.unmarked}</td><td>{m.cancelled}</td><td>{m.attendanceRate == null ? '–' : `${m.attendanceRate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <div className="card">
          <div className="row-head"><h3>{detail.member.name}</h3><button className="btn btn-ghost" onClick={() => setDetail(null)}>Close</button></div>
          {detail.history.length === 0 ? <p className="muted">No past classes in this period.</p> : (
            <ul className="plain">
              {detail.history.map((h) => <li key={h.id} className="roster-row"><span>{h.title} <small className="muted">{fmtDateTime(h.startsAt)}</small></span><Badge kind={KIND[h.status]}>{h.status.replace('_', ' ')}</Badge></li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
