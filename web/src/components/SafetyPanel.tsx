import type { SafetyReason, SafetyStatus } from '../api';
import { SAFETY, SafetyBadge } from './ui';

export function SafetyPanel({ status, reasons, compact = false }: { status: SafetyStatus; reasons: SafetyReason[]; compact?: boolean }) {
  const s = SAFETY[status];
  const flagged = reasons.filter((r) => r.severity !== 'info');
  const notes = reasons.filter((r) => r.severity === 'info');
  const cls = status === 'blocked' ? 'error' : status === 'suspicious' ? 'warn' : status === 'no_known_issue' ? 'ok' : 'info';
  return (
    <div className="stack-sm" aria-live="polite">
      <div className={`alert ${cls}`}>
        <div>
          <div className="row wrap"><SafetyBadge status={status} /></div>
          <div style={{ marginTop: 6, color: 'var(--text)' }}>{s.explain}</div>
          {flagged.length > 0 && <ul>{flagged.map((r) => <li key={r.code}>{r.message}</li>)}</ul>}
        </div>
      </div>
      {!compact && notes.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{notes.map((r) => <li key={r.code}>{r.message}</li>)}</ul>
      )}
      {!compact && <p className="hint">Automated checks reduce risk but can’t prove a website is safe. LinkPulse never visits the destination itself.</p>}
    </div>
  );
}
