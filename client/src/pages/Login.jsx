import { useState } from 'react';
import { ApiError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorNote, Field } from '../ui.jsx';

const DEMO = [
  ['Member', 'alice@gym.test', 'Member123!'],
  ['Trainer', 'tara@gym.test', 'Trainer123!'],
  ['Admin', 'admin@gym.test', 'Admin123!'],
];

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(''); setFieldErrors({});
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else setError('Unexpected error.');
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-hero">
        <h1>Spotlight<span>Gym</span></h1>
        <p>Book a class. If it is full, join the waitlist. If someone cancels, the spot is yours automatically.</p>
        <div className="demo">
          <p className="muted">Demo logins (tap to fill)</p>
          {DEMO.map(([role, email, password]) => (
            <button key={role} type="button" className="btn btn-ghost" onClick={() => { setMode('login'); setForm({ ...form, email, password }); }}>
              {role}: {email}
            </button>
          ))}
        </div>
      </div>
      <form className="card login-card" onSubmit={submit} noValidate>
        <h2>{mode === 'login' ? 'Sign in' : 'Create a member account'}</h2>
        {mode === 'register' && <Field label="Full name" error={fieldErrors.name}><input value={form.name} onChange={set('name')} autoComplete="name" /></Field>}
        <Field label="Email" error={fieldErrors.email}><input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></Field>
        <Field label="Password" error={fieldErrors.password}><input type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setFieldErrors({}); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
