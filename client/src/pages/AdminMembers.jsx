import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { Badge, ErrorNote, Field, Spinner, useToast } from '../ui.jsx';
import { fmtYmd, money } from '../utils.js';

export default function AdminMembers() {
  const toast = useToast();
  const [members, setMembers] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({}); // memberId -> {planId, startDate, error}

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([api.get('/admin/members'), api.get('/plans')]);
      setMembers(m.members); setPlans(p.plans.filter((x) => x.isActive)); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upd = (id, patch) => setForm((f) => ({ ...f, [id]: { ...f[id], ...patch } }));

  async function assign(m) {
    const f = form[m.id] || {};
    const planId = Number(f.planId || plans[0]?.id);
    try {
      const r = await api.post('/memberships', { userId: m.id, planId, ...(f.startDate ? { startDate: f.startDate } : {}) });
      toast(`${m.name}: membership ${fmtYmd(r.startDate)} to ${fmtYmd(r.endDate)}.`, 'success');
      upd(m.id, { error: '' }); load();
    } catch (e) { upd(m.id, { error: e instanceof ApiError ? e.message : 'Failed' }); }
  }

  async function reminders() {
    try { const r = await api.post('/admin/run-reminders'); toast(`Reminders: ${r.created} new (${r.checked} memberships expiring soon).`, 'info'); }
    catch (e) { toast(e.message, 'error'); }
  }

  return (
    <section>
      <div className="row-head"><h1>Members</h1><button className="btn" onClick={reminders}>Send expiry reminders now</button></div>
      <ErrorNote>{error}</ErrorNote>
      {!members ? <Spinner /> : members.map((m) => (
        <article key={m.id} className="card">
          <div className="row-head">
            <div><h3>{m.name}</h3><p className="muted">{m.email}</p></div>
            <div>
              <Badge kind={m.isActive ? 'good' : 'bad'}>{m.isActive ? 'Active' : 'Inactive'}</Badge>
              {m.membershipEnds && <p className="muted small">Last plan ends {fmtYmd(m.membershipEnds)}</p>}
            </div>
          </div>
          <div className="inline-form">
            <Field label="Plan">
              <select value={form[m.id]?.planId || plans[0]?.id || ''} onChange={(e) => upd(m.id, { planId: e.target.value })}>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.priceMinor)}</option>)}
              </select>
            </Field>
            <Field label="Start (optional)"><input type="date" value={form[m.id]?.startDate || ''} onChange={(e) => upd(m.id, { startDate: e.target.value })} /></Field>
            <button className="btn btn-primary" onClick={() => assign(m)} disabled={!plans.length}>Add membership</button>
          </div>
          <ErrorNote>{form[m.id]?.error}</ErrorNote>
        </article>
      ))}
    </section>
  );
}
