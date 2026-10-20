import { useState } from 'react';
import { Link as RLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useConfig } from '../config';
import { Bars, ClicksChart } from '../components/Charts';
import { Icon } from '../components/Icon';
import { LinkForm } from '../components/LinkForm';
import { QrCode } from '../components/QrCode';
import { SafetyPanel } from '../components/SafetyPanel';
import { CopyButton, Empty, ErrorBox, Modal, Spinner, StatusBadge, fmtDate, fmtNum, relTime, useToast } from '../components/ui';
import { useLoad } from '../hooks';
import { Stat } from './Dashboard';

const RANGES = [7, 30, 90];

export function LinkDetail() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === '1';
  const [days, setDays] = useState(30);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const { shortBaseUrl } = useConfig();
  const toast = useToast();
  const nav = useNavigate();
  const link = useLoad(() => api.getLink(id), [id]);
  const stats = useLoad(() => api.linkAnalytics(id, days), [id, days]);

  if (link.error) {
    const missing = link.error instanceof ApiError && link.error.status === 404;
    return missing
      ? <div className="card"><Empty title="Link not found" action={<RLink to="/links" className="btn">Back to My Links</RLink>}>It may have been deleted, or it belongs to another account.</Empty></div>
      : <ErrorBox error={link.error} onRetry={link.reload} />;
  }
  if (!link.data) return <Spinner />;
  const l = link.data.link;
  const setEdit = (on: boolean) => { const p = new URLSearchParams(params); on ? p.set('edit', '1') : p.delete('edit'); setParams(p, { replace: true }); };

  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try { await fn(); toast(msg); link.reload(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <RLink to="/links" className="small">← My Links</RLink>
          <h1 className="break" style={{ marginTop: 6 }}>{l.title || `/${l.code}`}</h1>
          <div className="row wrap" style={{ marginTop: 8 }}><StatusBadge status={l.effectiveStatus} />
            {l.campaign && <span className="badge brand">{l.campaign.name}</span>}
            {l.tags.map((t) => <span key={t.id} className="tag-chip"><span className="dot" style={{ background: t.color }} />{t.name}</span>)}</div>
        </div>
        <span className="spacer" />
        <div className="row wrap">
          <button className="btn secondary" onClick={() => setEdit(!editing)}><Icon name="edit" size={16} />{editing ? 'Close editor' : 'Edit'}</button>
          <button className="btn secondary" disabled={busy} onClick={() => act(() => api.updateLink(l.id, { status: l.status === 'active' ? 'disabled' : 'active' }), l.status === 'active' ? 'Link disabled.' : 'Link enabled.')}>
            <Icon name="power" size={16} />{l.status === 'active' ? 'Disable' : 'Enable'}</button>
          <button className="btn danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={16} />Delete</button>
        </div>
      </div>

      {editing && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h2 style={{ marginBottom: 16 }}>Edit link</h2>
          <LinkForm link={l} shortBase={shortBaseUrl} onSaved={(nl) => { link.setData({ link: nl }); setEdit(false); toast('Changes saved.'); stats.reload(); }} />
        </div>
      )}

      <div className="cols" style={{ marginBottom: 16 }}>
        <div className="card card-pad stack">
          <div className="field"><span className="label">Short link</span>
            <div className="row wrap"><a href={l.shortUrl} target="_blank" rel="noopener noreferrer" className="link-short break" style={{ fontSize: '1.15rem' }}>{l.shortUrl}</a><CopyButton text={l.shortUrl} /></div></div>
          <dl className="kv">
            <dt>Destination</dt><dd className="break"><a href={l.destinationUrl} target="_blank" rel="noopener noreferrer nofollow">{l.destinationUrl}</a></dd>
            <dt>Clicks used</dt><dd>{fmtNum(l.clickCount)}{l.maxClicks ? ` of ${fmtNum(l.maxClicks)} allowed` : ' (no limit)'}</dd>
            <dt>Expiry</dt><dd>{l.expiresAt ? fmtDate(l.expiresAt) : 'Never expires'}</dd>
            <dt>Password</dt><dd>{l.hasPassword ? 'Required to open' : 'None'}</dd>
            <dt>Alias type</dt><dd>{l.isCustomAlias ? 'Custom alias' : 'Random code'}</dd>
            <dt>Created</dt><dd>{fmtDate(l.createdAt)}</dd>
            <dt>Last click</dt><dd>{l.lastClickedAt ? `${fmtDate(l.lastClickedAt)} (${relTime(l.lastClickedAt)})` : 'No clicks yet'}</dd>
          </dl>
          <div>
            <div className="row" style={{ marginBottom: 8 }}><h2 className="spacer">Link safety</h2>
              <button className="btn secondary sm" disabled={busy} onClick={() => act(() => api.recheckSafety(l.id), 'Safety re-checked.')}><Icon name="refresh" size={14} />Re-check</button></div>
            <SafetyPanel status={l.safety.status} reasons={l.safety.reasons} />
            {l.safety.checkedAt && <p className="hint" style={{ marginTop: 6 }}>Last checked {fmtDate(l.safety.checkedAt)}</p>}
          </div>
        </div>
        <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>QR code</h2><QrCode url={l.shortUrl} code={l.code} /></div>
      </div>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <h2 className="spacer">Analytics</h2>
        <div className="seg" role="group" aria-label="Date range">
          {RANGES.map((r) => <button key={r} aria-pressed={days === r} onClick={() => setDays(r)}>{r} days</button>)}
        </div>
      </div>
      {stats.error ? <ErrorBox error={stats.error} onRetry={stats.reload} /> : !stats.data ? <Spinner /> : (
        <div className="stack">
          <div className="stats">
            <Stat k={`Clicks · ${days} days`} v={stats.data.totals.clicksInRange} />
            <Stat k="All-time clicks" v={stats.data.totals.allTimeClicks} />
            <Stat k="Bot / preview clicks" v={stats.data.totals.botClicksInRange} d={`in the last ${days} days`} />
            <Stat k="Unique visitors" v="—" d="Not tracked (privacy)" />
          </div>
          <div className="card card-pad"><h2 style={{ marginBottom: 12 }}>Clicks per day</h2>
            {stats.data.totals.clicksInRange === 0 ? <p className="muted">No clicks in this period. Open the short link to record one.</p> : <ClicksChart data={stats.data.daily} />}</div>
          <div className="cols-2">
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Referrers</h2><Bars data={stats.data.referrers} /></div>
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Devices</h2><Bars data={stats.data.devices} capitalize /></div>
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Browsers</h2><Bars data={stats.data.browsers} /></div>
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Operating systems</h2><Bars data={stats.data.operatingSystems} /></div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Recent clicks</h2></div>
            {stats.data.recentClicks.length === 0 ? <p className="muted card-pad">No clicks recorded yet.</p> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Time</th><th>Device</th><th>Browser</th><th>OS</th><th>Referrer</th></tr></thead>
                <tbody>{stats.data.recentClicks.map((c, i) => (
                  <tr key={i}><td>{fmtDate(c.clicked_at)}</td><td style={{ textTransform: 'capitalize' }}>{c.device_type}</td><td>{c.browser ?? '—'}</td><td>{c.os ?? '—'}</td><td>{c.referrer}</td></tr>
                ))}</tbody></table></div>)}
          </div>
          <div className="alert info"><Icon name="shield" /><div><b>Not available by design:</b> {stats.data.unavailable.location}</div></div>
        </div>
      )}

      {confirmDelete && (
        <Modal title="Delete this link?" onClose={() => setConfirmDelete(false)}>
          <p className="muted">The short link <b>/{l.code}</b> will stop working immediately and its click history will be permanently deleted. To pause it instead, use <b>Disable</b>.</p>
          <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn danger" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await api.deleteLink(l.id); toast('Link deleted.'); nav('/links'); } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
            }}>Delete permanently</button>
          </div>
        </Modal>
      )}
    </>
  );
}
