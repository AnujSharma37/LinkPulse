import { useState } from 'react';
import { Link as RLink } from 'react-router-dom';
import type { Link } from '../api';
import { useConfig } from '../config';
import { LinkForm } from '../components/LinkForm';
import { QrCode } from '../components/QrCode';
import { SafetyPanel } from '../components/SafetyPanel';
import { CopyButton } from '../components/ui';
import { Icon } from '../components/Icon';

export function NewLink() {
  const { shortBaseUrl } = useConfig();
  const [created, setCreated] = useState<Link | null>(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <div className="page-head"><div><h1>Create a short link</h1><p className="sub">Only http:// and https:// destinations are accepted.</p></div></div>
      {created ? (
        <div className="card card-pad stack" style={{ maxWidth: 720 }} data-testid="created">
          <div className="alert ok" role="status"><Icon name="check" />Your link was saved.</div>
          <div className="field"><span className="label">Short link</span>
            <div className="row wrap"><a className="link-short break" style={{ fontSize: '1.2rem' }} href={created.shortUrl} target="_blank" rel="noopener noreferrer" data-testid="short-url">{created.shortUrl}</a>
              <CopyButton text={created.shortUrl} small={false} /></div>
            <span className="muted small break">→ {created.destinationUrl}</span></div>
          <SafetyPanel status={created.safety.status} reasons={created.safety.reasons} />
          <QrCode url={created.shortUrl} code={created.code} />
          <div className="row wrap">
            <RLink className="btn" to={`/links/${created.id}`}>View details & analytics</RLink>
            <button className="btn secondary" onClick={() => { setCreated(null); setFormKey((k) => k + 1); }}>Create another</button>
          </div>
        </div>
      ) : (
        <div className="card card-pad" style={{ maxWidth: 720 }}>
          <LinkForm key={formKey} shortBase={shortBaseUrl} onSaved={setCreated} />
        </div>
      )}
    </>
  );
}
