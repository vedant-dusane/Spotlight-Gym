import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { Badge, ErrorNote, Field, Spinner, useToast } from '../ui.jsx';
import { money } from '../utils.js';

export default function AdminPlans() {
  const toast = useToast();
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'monthly', price: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(() => api.get('/plans').then((r) => setPlans(r.plans)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault(); setErrors({}); setError('');
    const rupees = Number(form.price);
    if (form.price === '' || Number.isNaN(rupees)) { setErrors({ priceMinor: 'Enter a price' }); return; }
    try {
      await api.post('/plans', { name: form.name, type: form.type, priceMinor: Math.round(rupees * 100) });
      toast('Plan created.', 'success'); setForm({ name: '', type: 'monthly', price: '' }); load();
    } catch (err) {
      setError(err.message);
      if (err instanceof ApiError) setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
    }
  }
  async function toggle(p) { try { await api.patch(`/plans/${p.id}`, { isActive: !p.isActive }); load(); } catch (e) { toast(e.message, 'error'); } }

  return (
    <section>
      <h1>Membership plans</h1>
      <form className="card form" onSubmit={create} noValidate>
        <h3>New plan</h3>
        <Field label="Name" error={errors.name}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="two">
          <Field label="Type" error={errors.type}>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="monthly">Monthly (1 month)</option><option value="quarterly">Quarterly (3 months)</option></select>
          </Field>
          <Field label="Price (₹)" error={errors.priceMinor}><input type="number" min="0" step="1" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary">Create plan</button>
      </form>
      {!plans ? <Spinner /> : plans.map((p) => (
        <article key={p.id} className="card row">
          <div><h3>{p.name}</h3><p className="muted">{p.type} · {money(p.priceMinor)}</p></div>
          <div className="actions"><Badge kind={p.isActive ? 'good' : 'bad'}>{p.isActive ? 'On sale' : 'Hidden'}</Badge><button className="btn" onClick={() => toggle(p)}>{p.isActive ? 'Hide' : 'Show'}</button></div>
        </article>
      ))}
    </section>
  );
}
