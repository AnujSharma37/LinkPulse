import { useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useConfig } from '../config';
import { Icon } from './Icon';

/** Shown above every signed-in page until the account's email address is confirmed. */
export function VerifyBanner() {
  const { user } = useAuth();
  const { emailVerificationRequired } = useConfig();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (!user || user.emailVerified) return null;

  async function resend() {
    setState('sending'); setError(null);
    try { await api.resendVerification(); setState('sent'); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send the email.'); setState('idle'); }
  }

  return (
    <div className={`alert ${emailVerificationRequired ? 'warn' : 'info'}`} role="status" style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <Icon name="alert" />
      <span style={{ flex: 1, minWidth: 200 }}>
        {emailVerificationRequired ? <b>Confirm your email to create links. </b> : <b>Please confirm your email address. </b>}
        We sent a link to {user.email}.{' '}
        {state === 'sent' && <b>A new link is on its way.</b>}
        {error && <span role="alert"> {error}</span>}
      </span>
      <button className="btn secondary sm" onClick={resend} disabled={state === 'sending' || state === 'sent'}>
        {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent' : 'Resend email'}
      </button>
    </div>
  );
}
