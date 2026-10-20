import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Campaign, type Link, type LinkInput, type SafetyResult, type Tag } from '../api';
import { Icon } from './Icon';
import { SafetyPanel } from './SafetyPanel';

/** Client-side checks give instant feedback; the server re-validates everything. */
function clientUrlError(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Destination URL is required.';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http:// and https:// URLs are allowed.';
  } catch {
    return 'Enter a full URL including https://';
  }
  return null;
}
const ALIAS_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/;

function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LinkForm({ link, shortBase, onSaved }: { link?: Link; shortBase: string; onSaved: (l: Link) => void }) {
  const editing = Boolean(link);
  const [destinationUrl, setDest] = useState(link?.destinationUrl ?? '');
  const [alias, setAlias] = useState('');
  const [title, setTitle] = useState(link?.title ?? '');
  const [expiresAt, setExpires] = useState(toLocalInput(link?.expiresAt ?? null));
  const [expDirty, setExpDirty] = useState(!link);
  const [pwMode, setPwMode] = useState<'keep' | 'set' | 'remove'>(link?.hasPassword ? 'keep' : 'remove');
  const [password, setPassword] = useState('');
  const [maxClicks, setMax] = useState(link?.maxClicks ? String(link.maxClicks) : '');
  const [campaignId, setCampaign] = useState(link?.campaign?.id ?? '');
  const [tagIds, setTagIds] = useState<string[]>(link?.tags.map((t) => t.id) ?? []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SafetyResult | null>(null);
  const [needsAck, setNeedsAck] = useState<SafetyResult | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.campaigns().then((r) => setCampaigns(r.campaigns)).catch(() => {});
    api.tags().then((r) => setTags(r.tags)).catch(() => {});
  }, []);

  async function runPreview() {
    if (clientUrlError(destinationUrl)) return setPreview(null);
    try { setPreview((await api.checkSafety(destinationUrl.trim())).safety); }
    catch (e) { if (e instanceof ApiError && e.status === 400) setErrors((x) => ({ ...x, destinationUrl: e.message })); }
  }

  function validate() {
    const e: Record<string, string> = {};
    const u = clientUrlError(destinationUrl); if (u) e.destinationUrl = u;
    if (!editing && alias.trim() && !ALIAS_RE.test(alias.trim())) e.alias = 'Use 3–32 letters, numbers, "-" or "_", starting with a letter or number.';
    if (expDirty && expiresAt && new Date(expiresAt).getTime() <= Date.now()) e.expiresAt = 'Expiry must be in the future.';
    if (pwMode === 'set' && password.length < 4) e.password = 'Link password must be at least 4 characters.';
    if (maxClicks && (!/^\d+$/.test(maxClicks) || Number(maxClicks) < 1)) e.maxClicks = 'Enter a whole number of 1 or more.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    const body: LinkInput = {
      destinationUrl: destinationUrl.trim(),
      title: title.trim() || null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      maxClicks: maxClicks ? Number(maxClicks) : null,
      campaignId: campaignId || null,
      tagIds,
      acknowledgeWarnings: ack || undefined,
    };
    if (!editing) {
      if (alias.trim()) body.alias = alias.trim();
      if (pwMode === 'set') body.password = password;
    } else {
      if (pwMode === 'set') body.password = password;
      else if (pwMode === 'remove' && link!.hasPassword) body.password = null;
      if (!expDirty) delete body.expiresAt;
    }
    setBusy(true);
    try {
      const r = editing ? await api.updateLink(link!.id, body) : await api.createLink(body);
      onSaved(r.link);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'safety_confirmation_required') { setNeedsAck(e.details.safety); setFormError(null); }
        else if (e.status === 422 && e.details?.safety) { setPreview(e.details.safety); setFormError(e.message); }
        else { setErrors(e.fieldErrors()); setFormError(e.message); }
      } else setFormError('Unexpected error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => errors[k] ? <span className="field-error" id={`${k}-err`}>{errors[k]}</span> : null;
  const aria = (k: string) => ({ 'aria-invalid': Boolean(errors[k]), 'aria-describedby': errors[k] ? `${k}-err` : undefined });

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {formError && <div className="alert error" role="alert"><Icon name="alert" />{formError}</div>}

      <div className="field">
        <label htmlFor="dest">Destination URL</label>
        <input id="dest" className="input" type="url" inputMode="url" placeholder="https://example.com/your-long-page" autoFocus={!editing}
          value={destinationUrl} onChange={(e) => { setDest(e.target.value); setNeedsAck(null); setAck(false); }} onBlur={runPreview} maxLength={2048} required {...aria('destinationUrl')} />
        {err('destinationUrl')}
      </div>
      {preview && !needsAck && <SafetyPanel status={preview.status} reasons={preview.reasons} compact />}

      {!editing && (
        <div className="field">
          <label htmlFor="alias">Custom alias <span className="faint">(optional)</span></label>
          <div className="input-group">
            <span className="prefix">{shortBase.replace(/^https?:\/\//, '')}/</span>
            <input id="alias" className="input" placeholder="random if empty" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={32} {...aria('alias')} />
          </div>
          {err('alias') ?? <span className="hint">Aliases are case-insensitive and can’t be changed later.</span>}
        </div>
      )}

      <div className="field">
        <label htmlFor="title">Title <span className="faint">(optional)</span></label>
        <input id="title" className="input" placeholder="e.g. Hackathon registration form" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="campaign">Campaign</label>
          <select id="campaign" className="select" value={campaignId} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">No campaign</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="label">Tags</span>
          {tags.length === 0 ? <span className="hint">No tags yet — create them on the Campaigns &amp; Tags page.</span> : (
            <div className="row wrap" role="group" aria-label="Tags">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button type="button" key={t.id} className={`tag-chip`} aria-pressed={on}
                    style={on ? { borderColor: t.color, color: 'var(--text)', background: 'var(--surface-2)' } : undefined}
                    onClick={() => setTagIds((ids) => on ? ids.filter((x) => x !== t.id) : [...ids, t.id])}>
                    <span className="dot" style={{ background: t.color }} />{t.name}{on && <Icon name="check" size={12} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <details className="adv" open={editing || Boolean(link?.hasPassword || link?.expiresAt || link?.maxClicks)}>
        <summary>Access rules — expiry, password, click limit</summary>
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="exp">Expires at <span className="faint">(optional)</span></label>
              <input id="exp" className="input" type="datetime-local" value={expiresAt} onChange={(e) => { setExpires(e.target.value); setExpDirty(true); }} {...aria('expiresAt')} />
              {err('expiresAt') ?? <span className="hint">After this time visitors see an “expired” page.</span>}
            </div>
            <div className="field">
              <label htmlFor="max">Click limit <span className="faint">(optional)</span></label>
              <input id="max" className="input" inputMode="numeric" placeholder="Unlimited" value={maxClicks} onChange={(e) => setMax(e.target.value)} {...aria('maxClicks')} />
              {err('maxClicks') ?? <span className="hint">{editing ? `${link!.clickCount} used so far.` : 'Link stops working after this many visits.'}</span>}
            </div>
          </div>
          <div className="field">
            <span className="label">Password protection</span>
            {editing && link!.hasPassword ? (
              <div className="seg" role="group" aria-label="Password option">
                <button type="button" aria-pressed={pwMode === 'keep'} onClick={() => setPwMode('keep')}>Keep current</button>
                <button type="button" aria-pressed={pwMode === 'set'} onClick={() => setPwMode('set')}>Change</button>
                <button type="button" aria-pressed={pwMode === 'remove'} onClick={() => setPwMode('remove')}>Remove</button>
              </div>
            ) : (
              <label className="check"><input type="checkbox" checked={pwMode === 'set'} onChange={(e) => setPwMode(e.target.checked ? 'set' : 'remove')} />Require a password to open this link</label>
            )}
            {pwMode === 'set' && (
              <>
                <input className="input" type="password" autoComplete="new-password" placeholder="Link password (min 4 characters)" aria-label="Link password"
                  value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} {...aria('password')} />
                {err('password') ?? <span className="hint">Stored only as a secure hash. Share it with visitors separately.</span>}
              </>
            )}
          </div>
        </div>
      </details>

      {needsAck && (
        <div className="stack-sm">
          <SafetyPanel status={needsAck.status} reasons={needsAck.reasons} compact />
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I’ve reviewed these warnings and still want to {editing ? 'save' : 'create'} this link. Visitors will see a warning page first.</label>
        </div>
      )}

      <div className="row">
        <button className="btn lg" type="submit" disabled={busy || (needsAck !== null && !ack)}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create short link'}
        </button>
      </div>
    </form>
  );
}
