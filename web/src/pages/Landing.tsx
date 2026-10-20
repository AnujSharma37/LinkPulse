import { Link as RLink, Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Brand } from '../components/Layout';
import { Icon } from '../components/Icon';

const FEATURES = [
  { icon: 'link', title: 'Short links that just work', text: 'Random or custom aliases, stored in a real database, resolved on every visit by the server.' },
  { icon: 'lock', title: 'Access rules', text: 'Set an expiry date, a password or a click limit. Every rule is enforced server-side before redirecting.' },
  { icon: 'shield', title: 'Honest safety checks', text: 'Format validation, blocklists, phishing heuristics and optional Google Safe Browsing — with clear labels, never “guaranteed safe”.' },
  { icon: 'chart', title: 'Real analytics', text: 'Clicks per day, referrers, devices and campaigns — computed from recorded events, nothing invented.' },
  { icon: 'folder', title: 'Campaigns & tags', text: 'Group links, auto-append UTM parameters and compare how each campaign performs.' },
  { icon: 'qr', title: 'QR codes', text: 'Download PNG or SVG QR codes for posters and slides. Scans are tracked like clicks.' },
];

export function Landing() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;
  return (
    <div>
      <nav className="landing-nav" aria-label="Site">
        <Brand />
        <span className="spacer" />
        <RLink to="/login" className="btn ghost">Log in</RLink>
        <RLink to="/signup" className="btn">Get started</RLink>
      </nav>
      <section className="hero">
        <div>
          <span className="badge brand" style={{ whiteSpace: "normal" }}><Icon name="pulse" size={13} />Smart Links. Safer Sharing. Clear Insights.</span>
          <h1 style={{ marginTop: 18 }}>Shorten links. <span className="grad">See the pulse</span> of every click.</h1>
          <p className="lead">LinkPulse turns long URLs into short, trackable links — with passwords, expiry dates, click limits, QR codes and transparent safety checks.</p>
          <div className="row wrap">
            <RLink to="/signup" className="btn lg">Create a free account</RLink>
            <RLink to="/login" className="btn lg secondary">I already have one</RLink>
          </div>
        </div>
        <div className="card hero-card" aria-hidden="true">
          <div className="stack">
            <div className="field"><span className="label">Destination URL</span><div className="input muted truncate">https://forms.example.edu/hackathon-2026/registration?ref=poster</div></div>
            <div className="field"><span className="label">Your short link</span>
              <div className="row"><div className="input" style={{ fontWeight: 650 }}>lnk.pulse/hack26</div><span className="btn sm secondary"><Icon name="copy" size={14} />Copy</span></div></div>
            <div className="row wrap"><span className="badge info"><Icon name="shield" size={12} />URL format valid</span><span className="badge"><Icon name="clock" size={12} />Expires 30 Nov</span><span className="badge"><Icon name="lock" size={12} />Password</span></div>
            <p className="hint">Illustration of the create-link form. Your real links and stats appear in your dashboard.</p>
          </div>
        </div>
      </section>
      <section className="features" aria-label="Features">
        {FEATURES.map((f) => (
          <div key={f.title} className="card feature">
            <div className="ico"><Icon name={f.icon} size={20} /></div>
            <h3>{f.title}</h3><p>{f.text}</p>
          </div>
        ))}
      </section>
      <footer className="footer">LinkPulse · built by a five-person hackathon team · Privacy-light analytics: no IP addresses or locations stored.</footer>
    </div>
  );
}
