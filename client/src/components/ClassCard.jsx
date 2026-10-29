import { Badge, Spots } from '../ui.jsx';
import { fmtTime } from '../utils.js';

/** One class in the member schedule. Every button state is decided here; the server re-checks everything. */
export default function ClassCard({ c, busy, onBook, onCancel }) {
  const closed = Date.now() > Date.parse(c.bookingClosesAt);
  const my = c.my;
  const cancelled = c.status === 'cancelled';

  let action = null;
  if (cancelled) action = null;
  else if (my && my.status === 'waitlisted') {
    action = <button className="btn btn-ghost" disabled={busy} onClick={() => onCancel(my.bookingId, true)}>Leave waitlist</button>;
  } else if (my) {
    action = closed
      ? <button className="btn" disabled title="Cancellations close 2 hours before the class">Cancel closed</button>
      : <button className="btn btn-danger" disabled={busy} onClick={() => onCancel(my.bookingId, false)}>Cancel booking</button>;
  } else if (closed) {
    action = <button className="btn" disabled>Booking closed</button>;
  } else {
    action = <button className="btn btn-primary" disabled={busy} onClick={() => onBook(c)}>
      {c.isFull ? `Join waitlist${c.waitlistCount ? ` (${c.waitlistCount} waiting)` : ''}` : 'Book'}
    </button>;
  }

  return (
    <article className={`card class ${cancelled ? 'is-cancelled' : ''}`}>
      <div className="class-time">
        <strong>{fmtTime(c.startsAt)}</strong>
        <small>{c.durationMinutes} min</small>
      </div>
      <div className="class-body">
        <h3>{c.title}</h3>
        <p className="muted">with {c.trainerName}</p>
        {c.description ? <p className="desc">{c.description}</p> : null}
        <Spots booked={c.bookedCount} capacity={c.capacity} />
        <p className="small">
          {cancelled ? <Badge kind="bad">Cancelled</Badge>
            : c.isFull ? <>Full · {c.waitlistCount} on waitlist</>
            : <>{c.spotsLeft} of {c.capacity} spots left</>}
          {my?.status === 'waitlisted' ? <> <Badge kind="warn">Waitlist #{my.waitlistPosition}</Badge></> : null}
          {my && my.status !== 'waitlisted' ? <> <Badge kind="good">You're booked</Badge></> : null}
        </p>
      </div>
      <div className="class-action">{action}</div>
    </article>
  );
}
