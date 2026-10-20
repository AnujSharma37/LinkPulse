import { useState, type FormEvent } from 'react';
import { Link as RLink, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Brand } from '../components/Layout';
import { Icon } from '../components/Icon';

function safeNext(next: string | null) {
  // Only allow same-site relative paths (prevents open redirects via ?next=).
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/dashboard';
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { user, login, signup } = useAuth();
  const [params] = useSearchParams();
  const justReset = params.get('reset') === '1';
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));
  if (user) return <Navigate to={next} replace />;

  function validate() {
    const e: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Enter a valid email address.';
    if (mode === 'signup') {
      if (password.length < 8) e.password = 'Password must be at least 8 characters.';
      else if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) e.password = 'Use at least one letter and one number.';
    } else if (!password) e.password = 'Password is required.';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else {
        const { pending } = await signup(email.trim(), password, name.trim() || undefined);
        if (pending) { setPendingEmail(email.trim()); return; } // confirm by email first; no session yet
      }
      nav(next, { replace: true });
    } catch (e) {
      if (e instanceof ApiError) { setErrors(e.fieldErrors()); setError(e.message); } else setError('Unexpected error.');
    } finally { setBusy(false); }
  }
  const signupMode = mode === 'signup';
  if (pendingEmail) {
    return (
      <div className="auth-wrap"><div className="card auth-card">
        <Brand />
        <h1>Check your email</h1>
        <div className="alert ok" role="status" style={{ marginTop: 16 }}><Icon name="check" />
          <span>If <b>{pendingEmail}</b> can be used for a new account, we've sent a confirmation link. Open it, then log in.</span></div>
        <p className="muted small" style={{ marginTop: 16 }}>Nothing after a few minutes? Check spam, or <RLink to="/login">log in</RLink> and we'll send a fresh link.</p>
      </div></div>
    );
  }
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Brand />
        <h1>{signupMode ? 'Create your account' : 'Welcome back'}</h1>
        <p className="muted" style={{ margin: '6px 0 20px' }}>{signupMode ? 'Start shortening and tracking links in seconds.' : 'Log in to manage your links.'}</p>
        <form className="stack" onSubmit={submit} noValidate>
          {justReset && !error && <div className="alert ok" role="status"><Icon name="check" />Password updated. Log in with your new password.</div>}
          {error && <div className="alert error" role="alert"><Icon name="alert" />{error}</div>}
          {signupMode && (
            <div className="field"><label htmlFor="name">Name <span className="faint">(optional)</span></label>
              <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
          )}
          <div className="field"><label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-err' : undefined} required />
            {errors.email && <span id="email-err" className="field-error">{errors.email}</span>}</div>
          <div className="field"><label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete={signupMode ? 'new-password' : 'current-password'} value={password}
              onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'pw-err' : undefined} required maxLength={128} />
            {errors.password ? <span id="pw-err" className="field-error">{errors.password}</span> : signupMode && <span className="hint">At least 8 characters, with a letter and a number.</span>}</div>
          {!signupMode && <div style={{ textAlign: 'right', marginTop: -6 }}><RLink className="small" to="/forgot-password">Forgot your password?</RLink></div>}
          <button className="btn lg block" type="submit" disabled={busy}>{busy ? 'Please wait…' : signupMode ? 'Create account' : 'Log in'}</button>
        </form>
        <p className="muted small" style={{ marginTop: 18, textAlign: 'center' }}>
          {signupMode ? <>Already have an account? <RLink to="/login">Log in</RLink></> : <>New to LinkPulse? <RLink to="/signup">Create an account</RLink></>}
        </p>
      </div>
    </div>
  );
}
