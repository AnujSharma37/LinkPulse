import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EffectiveStatus, SafetyStatus } from '../api';
import { Icon } from './Icon';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="center" role="status"><div className="spinner" /><span className="sr-only">{label}</span></div>;
}

export function Empty({ icon = 'link', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} size={26} /></div>
      <h2>{title}</h2>
      {children && <p className="muted" style={{ maxWidth: 420 }}>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="alert error" role="alert">
      <Icon name="alert" />
      <div className="spacer">{msg}</div>
      {onRetry && <button className="btn sm secondary" onClick={onRetry}>Retry</button>}
    </div>
  );
}

const STATUS: Record<EffectiveStatus, { cls: string; label: string }> = {
  active: { cls: 'ok', label: 'Active' },
  disabled: { cls: '', label: 'Disabled' },
  expired: { cls: 'warn', label: 'Expired' },
  limit_reached: { cls: 'warn', label: 'Limit reached' },
  blocked: { cls: 'err', label: 'Blocked' },
};
export function StatusBadge({ status }: { status: EffectiveStatus }) {
  const s = STATUS[status];
  return <span className={`badge ${s.cls}`}><span className="dot" style={{ background: 'currentColor' }} />{s.label}</span>;
}

export const SAFETY: Record<SafetyStatus, { cls: string; label: string; explain: string }> = {
  format_valid: {
    cls: 'info', label: 'URL format valid',
    explain: 'The address is a well-formed http/https URL and passed our basic checks. Its reputation was not checked against a threat-intelligence service.',
  },
  no_known_issue: {
    cls: 'ok', label: 'No known issue found',
    explain: 'Our checks and the threat-intelligence lookup found nothing. This is not a guarantee that the site is safe.',
  },
  suspicious: {
    cls: 'warn', label: 'Suspicious',
    explain: 'One or more automated checks flagged this URL. Visitors see a warning page before they are redirected.',
  },
  blocked: {
    cls: 'err', label: 'Blocked',
    explain: 'This URL matched a blocklist or threat feed, or points to a forbidden address. LinkPulse will not redirect to it.',
  },
};
export function SafetyBadge({ status }: { status: SafetyStatus }) {
  const s = SAFETY[status];
  return <span className={`badge ${s.cls}`} title={s.explain}><Icon name="shield" size={12} />{s.label}</span>;
}

/* ── Toasts ── */
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function CopyButton({ text, label = 'Copy', small = true }: { text: string; label?: string; small?: boolean }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true); toast('Copied to clipboard');
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast('Could not access the clipboard. Select the link and copy it manually.', 'error');
    }
  }
  return (
    <button type="button" className={`btn secondary ${small ? 'sm' : ''}`} onClick={copy} aria-label={`${label} ${text}`}>
      <Icon name={done ? 'check' : 'copy'} size={15} />{done ? 'Copied' : label}
    </button>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head"><h2 className="spacer">{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="card-pad">{children}</div>
      </div>
    </div>
  );
}

export const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtNum = (n: number) => n.toLocaleString();
export function relTime(s: string | null) {
  if (!s) return 'never';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month']];
  for (let i = 0; i < steps.length; i++) {
    const [limit] = steps[i];
    if (Math.abs(diff) < limit) {
      const div = i === 0 ? 1 : steps[i - 1][0];
      return rtf.format(-Math.round(diff / div), steps[i][1]);
    }
  }
  return rtf.format(-Math.round(diff / 31557600), 'year');
}
