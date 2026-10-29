import { useState } from 'react';
import { api, ApiError } from '../api.js';
import { ErrorNote, Field, useToast } from '../ui.jsx';
import { fromLocalInput, toLocalInput } from '../utils.js';

/** Create (no `existing`) or edit a class. Validation is repeated on the server; field errors come back by name. */
export default function ClassForm({ trainers, existing, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState(() => existing ? {
    title: existing.title, description: existing.description || '', trainerId: existing.trainerId,
    startsAt: toLocalInput(existing.startsAt), durationMinutes: existing.durationMinutes, capacity: existing.capacity,
  } : { title: '', description: '', trainerId: trainers[0]?.id || '', startsAt: '', durationMinutes: 60, capacity: 10 });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(''); setErrors({});
    if (!f.startsAt) { setErrors({ startsAt: 'Pick a start date and time' }); setBusy(false); return; }
    const body = {
      title: f.title, description: f.description || null, trainerId: Number(f.trainerId),
      startsAt: fromLocalInput(f.startsAt), durationMinutes: Number(f.durationMinutes), capacity: Number(f.capacity),
    };
    try {
      if (existing) {
        const r = await api.patch(`/classes/${existing.id}`, body);
        toast(r.promoted?.length ? `Saved. ${r.promoted.length} member(s) moved in from the waitlist.` : 'Class updated.', 'success');
      } else {
        await api.post('/classes', body);
        toast('Class created.', 'success');
      }
      onDone();
    } catch (err) {
      setError(err.message);
      if (err instanceof ApiError) setErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
    } finally { setBusy(false); }
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h3>{existing ? 'Edit class' : 'New class'}</h3>
      <Field label="Title (e.g. Yoga, HIIT)" error={errors.title}><input value={f.title} onChange={set('title')} /></Field>
      <Field label="Trainer" error={errors.trainerId}>
        <select value={f.trainerId} onChange={set('trainerId')}>{trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </Field>
      <Field label="Starts" error={errors.startsAt}><input type="datetime-local" value={f.startsAt} onChange={set('startsAt')} /></Field>
      <div className="two">
        <Field label="Duration (min)" error={errors.durationMinutes}><input type="number" min="15" max="240" value={f.durationMinutes} onChange={set('durationMinutes')} /></Field>
        <Field label="Capacity" error={errors.capacity}><input type="number" min="1" max="200" value={f.capacity} onChange={set('capacity')} /></Field>
      </div>
      <Field label="Description (optional)" error={errors.description}><textarea rows="2" value={f.description} onChange={set('description')} /></Field>
      <ErrorNote>{error}</ErrorNote>
      <div className="actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Create class'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Close</button>}
      </div>
    </form>
  );
}
