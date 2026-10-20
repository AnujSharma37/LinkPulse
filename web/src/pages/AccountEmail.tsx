import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link as RLink, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Brand } from '../components/Layout';
import { Icon } from '../components/Icon';

function Shell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Brand />
        <h1>{title}</h1>
        {lead && <p className="muted" style={{ margin: '6px 0 20px' }}>{lead}</p>}
        {children}
      </div>
    </div>
  );
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

/** Step 1 of a password reset: ask for the address. The answer is the same whether or not it has an account. */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    try { await api.forgotPassword(email.trim()); setSent(true); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  if (sent) {
    return (
      <Shell title="Check your inbox">
        <div className="alert ok" role="status"><Icon name="check" />
          <span>If an account exists for <b>{email.trim()}</b>, we've sent a link to reset the password. It expires in an hour.</span></div>
        <p className="muted small" style={{ marginTop: 16 }}>Nothing arrived? Check your spam folder, or <button className="linklike" onClick={() => setSent(false)}>try again</button>.</p>
        <p className="muted small"><RLink to="/login">Back to log in</RLink></p>
      </Shell>
    );
  }
  return (
    <Shell title="Forgot your password?" lead="Enter your email and we'll send you a link to choose a new one.">
      <form className="stack" onSubmit={submit} noValidate>
        {error && <div className="alert error" role="alert"><Icon name="alert" />{error}</div>}
        <div className="field"><label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <button className="btn lg block" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <p className="muted small" style={{ marginTop: 18, textAlign: 'center' }}><RLink to="/login">Back to log in</RLink></p>
    </Shell>
  );
}

/** Step 2: the page the emailed link opens. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  // Read the token once, then take it out of the address bar so it doesn't linger in history or screenshots.
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => { if (params.has('token')) nav('/reset-password', { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) { setError('Use at least one letter and one number.'); return; }
    setBusy(true);
    try { await api.resetPassword(token, password); nav('/login?reset=1', { replace: true }); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_token') setExpired(true); else setError(message(e));
    } finally { setBusy(false); }
  }

  if (!token || expired) {
    return (
      <Shell title="This link can't be used">
        <div className="alert warn" role="alert"><Icon name="alert" />
          <span>The reset link is missing, expired or was already used. Reset links work once and last an hour.</span></div>
        <RLink className="btn lg block" style={{ marginTop: 16 }} to="/forgot-password">Get a new link</RLink>
      </Shell>
    );
  }
  return (
    <Shell title="Choose a new password" lead="You'll be signed out everywhere and asked to log in again.">
      <form className="stack" onSubmit={submit} noValidate>
        {error && <div className="alert error" role="alert"><Icon name="alert" />{error}</div>}
        <div className="field"><label htmlFor="password">New password</label>
          <input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} />
          <span className="hint">At least 8 characters, with a letter and a number.</span></div>
        <button className="btn lg block" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </form>
    </Shell>
  );
}

/**
 * The page the confirmation link opens. It asks for one click instead of confirming automatically, so
 * email scanners and link previews that merely load the page can't use up the one-time token.
 */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user, refresh } = useAuth();
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => { if (params.has('token')) nav('/verify-email', { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<'ready' | 'busy' | 'done' | 'failed'>('ready');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState('busy'); setError(null);
    try { await api.verifyEmail(token); await refresh(); setState('done'); }
    catch (e) { setError(message(e)); setState('failed'); }
  }

  if (state === 'done') {
    return (
      <Shell title="Email confirmed">
        <div className="alert ok" role="status"><Icon name="check" />Thanks — your email address is confirmed.</div>
        <RLink className="btn lg block" style={{ marginTop: 16 }} to={user ? '/dashboard' : '/login'}>{user ? 'Go to dashboard' : 'Log in'}</RLink>
      </Shell>
    );
  }
  if (!token || state === 'failed') {
    return (
      <Shell title="This link can't be used">
        <div className="alert warn" role="alert"><Icon name="alert" /><span>{error ?? 'The confirmation link is missing.'}</span></div>
        <p className="muted small" style={{ marginTop: 16 }}>Log in and use “Resend email” at the top of your dashboard to get a new link.</p>
        <RLink className="btn lg block" to={user ? '/dashboard' : '/login'}>{user ? 'Go to dashboard' : 'Log in'}</RLink>
      </Shell>
    );
  }
  return (
    <Shell title="Confirm your email" lead="One click to finish.">
      <button className="btn lg block" onClick={confirm} disabled={state === 'busy'}>{state === 'busy' ? 'Confirming…' : 'Confirm my email address'}</button>
    </Shell>
  );
}
