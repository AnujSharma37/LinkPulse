import { Link as RLink } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Bars, ClicksChart } from '../components/Charts';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, SafetyBadge, Spinner, StatusBadge, fmtNum, relTime } from '../components/ui';
import { useLoad } from '../hooks';

export function Stat({ k, v, d }: { k: string; v: string | number; d?: string }) {
  return <div className="card stat"><div className="k">{k}</div><div className="v">{typeof v === 'number' ? fmtNum(v) : v}</div>{d && <div className="d">{d}</div>}</div>;
}

export function Dashboard() {
  const { user } = useAuth();
  const ov = useLoad(() => api.overview(30), []);
  const recent = useLoad(() => api.listLinks({ pageSize: 5 }), []);

  return (
    <>
      <div className="page-head">
        <div><h1>Welcome back{user?.displayName ? `, ${user.displayName}` : ''}</h1><p className="sub">Here’s how your links performed over the last 30 days.</p></div>
        <span className="spacer" />
        <RLink className="btn" to="/links/new"><Icon name="plus" size={16} />Create link</RLink>
      </div>
      {ov.error ? <ErrorBox error={ov.error} onRetry={ov.reload} /> : !ov.data ? <Spinner /> : (
        <div className="stack">
          <div className="stats">
            <Stat k="Total links" v={ov.data.links.total} d={`${ov.data.links.active} currently active`} />
            <Stat k="Clicks · 30 days" v={ov.data.totals.clicksInRange} d={`${ov.data.totals.botClicksInRange} from bots / previews`} />
            <Stat k="All-time clicks" v={ov.data.totals.allTimeClicks} d={`Last click ${relTime(ov.data.totals.lastClickAt)}`} />
            <Stat k="Flagged links" v={ov.data.links.suspicious} d="Marked suspicious by safety checks" />
          </div>
          {ov.data.links.total === 0 ? (
            <div className="card"><Empty title="Create your first short link" action={<RLink to="/links/new" className="btn">Create link</RLink>}>
              Paste a long URL, pick an optional alias, and LinkPulse will start counting real clicks.</Empty></div>
          ) : (
            <>
              <div className="cols">
                <div className="card card-pad"><div className="row" style={{ marginBottom: 12 }}><h2 className="spacer">Clicks per day</h2><RLink to="/analytics" className="small">Full analytics →</RLink></div>
                  {ov.data.totals.clicksInRange === 0 ? <p className="muted">No clicks yet in the last 30 days. Share a link to see data here.</p> : <ClicksChart data={ov.data.daily} />}</div>
                <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Top links</h2>
                  {ov.data.topLinks.length === 0 ? <p className="muted small">No clicks in this period yet.</p> : (
                    <ol className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
                      {ov.data.topLinks.map((l) => <li key={l.id}><div className="row"><RLink to={`/links/${l.id}`} className="truncate spacer">{l.title || `/${l.code}`}</RLink><b className="mono">{l.clicks}</b></div></li>)}
                    </ol>)}</div>
              </div>
              <div className="card">
                <div className="card-head"><h2 className="spacer">Recent links</h2><RLink to="/links" className="small">View all →</RLink></div>
                {recent.error ? <div className="card-pad"><ErrorBox error={recent.error} onRetry={recent.reload} /></div> : !recent.data ? <Spinner /> :
                  recent.data.links.map((l) => (
                    <div key={l.id} className="link-row">
                      <div className="link-main">
                        <RLink to={`/links/${l.id}`} className="link-short truncate">{l.shortUrl.replace(/^https?:\/\//, '')}</RLink>
                        <span className="muted small truncate">{l.title ? `${l.title} · ` : ''}{l.destinationUrl}</span>
                      </div>
                      <div className="row"><StatusBadge status={l.effectiveStatus} /><SafetyBadge status={l.safety.status} /><span className="clicks"><b>{fmtNum(l.clickCount)}</b><span className="faint small">clicks</span></span></div>
                    </div>
                  ))}
              </div>
              <div className="cols-2">
                <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Devices</h2><Bars data={ov.data.devices} capitalize /></div>
                <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Top referrers</h2><Bars data={ov.data.referrers} /></div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
