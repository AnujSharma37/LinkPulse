import { useState } from 'react';
import { Link as RLink } from 'react-router-dom';
import { api } from '../api';
import { Bars, ClicksChart } from '../components/Charts';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Spinner, relTime } from '../components/ui';
import { useLoad } from '../hooks';
import { Stat } from './Dashboard';

export function Analytics() {
  const [days, setDays] = useState(30);
  const ov = useLoad(() => api.overview(days), [days]);
  return (
    <>
      <div className="page-head">
        <div><h1>Analytics</h1><p className="sub">Computed live from recorded click events across all your links.</p></div>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Date range">
          {[7, 30, 90, 365].map((r) => <button key={r} aria-pressed={days === r} onClick={() => setDays(r)}>{r === 365 ? '1 year' : `${r} days`}</button>)}
        </div>
      </div>
      {ov.error ? <ErrorBox error={ov.error} onRetry={ov.reload} /> : !ov.data ? <Spinner /> : ov.data.totals.allTimeClicks === 0 ? (
        <div className="card"><Empty icon="chart" title="No clicks recorded yet" action={<RLink to="/links" className="btn">Go to My Links</RLink>}>
          Analytics appear as soon as someone opens one of your short links. We never show sample or estimated data.</Empty></div>
      ) : (
        <div className="stack">
          <div className="stats">
            <Stat k={`Clicks · ${days === 365 ? '1 year' : `${days} days`}`} v={ov.data.totals.clicksInRange} />
            <Stat k="Human clicks" v={ov.data.totals.clicksInRange - ov.data.totals.botClicksInRange} d="Excludes known bots & link previews" />
            <Stat k="All-time clicks" v={ov.data.totals.allTimeClicks} d={`Last click ${relTime(ov.data.totals.lastClickAt)}`} />
            <Stat k="Active links" v={ov.data.links.active} d={`of ${ov.data.links.total} total`} />
          </div>
          <div className="card card-pad"><h2 style={{ marginBottom: 12 }}>Clicks per day</h2><ClicksChart data={ov.data.daily} /></div>
          <div className="cols-2">
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Top links</h2>
              <Bars data={ov.data.topLinks.map((l) => ({ label: l.title || `/${l.code}`, clicks: l.clicks }))} /></div>
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Campaigns</h2><Bars data={ov.data.campaigns} /></div>
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Referrers</h2><Bars data={ov.data.referrers} /></div>
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Devices</h2><Bars data={ov.data.devices} capitalize /></div>
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Browsers</h2><Bars data={ov.data.browsers} /></div>
            <div className="card card-pad"><h2 style={{ marginBottom: 14 }}>Operating systems</h2><Bars data={ov.data.operatingSystems} /></div>
          </div>
          <div className="card card-pad stack-sm">
            <h2>Metrics we don’t collect</h2>
            <p className="small muted"><Icon name="shield" size={14} /> <b>Visitor location:</b> {ov.data.unavailable.location}</p>
            <p className="small muted"><Icon name="shield" size={14} /> <b>Unique visitors:</b> {ov.data.unavailable.uniqueVisitors}</p>
            <p className="small muted">Referrers are often hidden by browsers and apps, so “Direct / unknown” includes messaging apps, QR scans and bookmarks.</p>
          </div>
        </div>
      )}
    </>
  );
}
