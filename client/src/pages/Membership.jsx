import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { Badge, ErrorNote, Field, Spinner, useToast } from '../ui.jsx';
import { fmtYmd, money } from '../utils.js';

const STATE = { active: 'good', upcoming: 'warn', expired: 'bad', cancelled: 'bad' };

export default function Membership() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([api.get('/memberships/me'), api.get('/plans')]);
      setData(m); setPlans(p.plans);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function buy(plan) {
    if (!window.confirm(`Buy ${plan.name} for ${money(plan.priceMinor)}? (Payment is simulated in this demo.)`)) return;
    setBusy(true); setError(''); setFieldError('');
    try {
      const r = await api.post('/memberships', { planId: plan.id, ...(startDate ? { startDate } : {}) });
      toast(`Membership active ${fmtYmd(r.startDate)} to ${fmtYmd(r.endDate)}.`, 'success');
      setStartDate(''); load();
    } catch (e) {
      setError(e.message);
      if (e instanceof ApiError) setFieldError(e.field('startDate') || '');
    } finally { setBusy(false); }
  }

  if (!data) return error ? <ErrorNote>{error}</ErrorNote> : <Spinner />;
  const { current } = data;

  return (
    <section>
      <h1>Membership</h1>
      <div className={`card status ${current ? 'status-on' : 'status-off'}`}>
        {current ? (
          <>
            <h2>{current.planName} · active</h2>
            <p>{fmtYmd(current.startDate)} to {fmtYmd(current.endDate)} · {current.daysLeft} day(s) left</p>
          </>
        ) : (
          <>
            <h2>No active membership</h2>
            <p>Pick a plan below to start booking classes.</p>
          </>
        )}
      </div>

      <h2>Plans</h2>
      <Field label="Start date (optional, defaults to today or right after your current plan ends)" error={fieldError}>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid">
        {plans.map((p) => (
          <article key={p.id} className="card plan">
            <h3>{p.name}</h3>
            <p className="price">{money(p.priceMinor)}</p>
            <p className="muted">{p.type === 'monthly' ? '1 month' : '3 months'}</p>
            <button className="btn btn-primary" disabled={busy} onClick={() => buy(p)}>{current ? 'Renew / extend' : 'Buy'}</button>
          </article>
        ))}
      </div>

      <h2>History</h2>
      {data.memberships.length === 0 ? <p className="muted">No memberships yet.</p> : data.memberships.map((m) => (
        <article key={m.id} className="card row">
          <div><h3>{m.planName}</h3><p className="muted">{fmtYmd(m.startDate)} to {fmtYmd(m.endDate)}</p></div>
          <Badge kind={STATE[m.state]}>{m.state}</Badge>
        </article>
      ))}
    </section>
  );
}
