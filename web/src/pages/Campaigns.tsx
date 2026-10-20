import { useState, type FormEvent } from 'react';
import { Link as RLink } from 'react-router-dom';
import { api, ApiError, type Campaign, type Tag } from '../api';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Modal, Spinner, fmtNum, useToast } from '../components/ui';
import { useLoad } from '../hooks';

const COLORS = ['#6366f1', '#14a3b8', '#f59e0b', '#ec4899', '#10b981', '#ef4444', '#8b5cf6', '#64748b'];

function CampaignForm({ initial, onDone }: { initial?: Campaign; onDone: () => void }) {
  const [f, setF] = useState({ name: initial?.name ?? '', description: initial?.description ?? '', utmSource: initial?.utmSource ?? '', utmMedium: initial?.utmMedium ?? '', utmCampaign: initial?.utmCampaign ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setError('Campaign name is required.');
    setBusy(true); setError(null);
    try {
      if (initial) await api.updateCampaign(initial.id, f); else await api.createCampaign(f);
      toast(initial ? 'Campaign updated.' : 'Campaign created.'); onDone();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Unexpected error.'); } finally { setBusy(false); }
  }
  const input = (k: keyof typeof f, label: string, ph = '') => (
    <div className="field"><label htmlFor={`c-${k}`}>{label}</label>
      <input id={`c-${k}`} className="input" placeholder={ph} value={f[k]} maxLength={k === 'description' ? 500 : 100} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && <div className="alert error" role="alert">{error}</div>}
      {input('name', 'Name', 'e.g. Hackathon posters')}
      {input('description', 'Description (optional)')}
      <p className="hint">Optional UTM tags are added to the destination when someone opens a link in this campaign (existing UTM values in the URL are kept).</p>
      <div className="grid-2">{input('utmSource', 'utm_source', 'poster')}{input('utmMedium', 'utm_medium', 'qr')}</div>
      {input('utmCampaign', 'utm_campaign', 'hackathon-2026')}
      <button className="btn" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save campaign' : 'Create campaign'}</button>
    </form>
  );
}

export function Campaigns() {
  const camps = useLoad(() => api.campaigns(), []);
  const tags = useLoad(() => api.tags(), []);
  const [edit, setEdit] = useState<Campaign | 'new' | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState(COLORS[0]);
  const [tagError, setTagError] = useState<string | null>(null);
  const toast = useToast();

  async function addTag(e: FormEvent) {
    e.preventDefault();
    if (!tagName.trim()) return setTagError('Tag name is required.');
    setTagError(null);
    try { await api.createTag({ name: tagName.trim(), color: tagColor }); setTagName(''); tags.reload(); toast('Tag created.'); }
    catch (err) { setTagError((err as Error).message); }
  }
  async function remove(kind: 'campaign' | 'tag', item: Campaign | Tag) {
    if (!window.confirm(`Delete ${kind} “${item.name}”? Links stay, they just lose this ${kind}.`)) return;
    try {
      if (kind === 'campaign') { await api.deleteCampaign(item.id); camps.reload(); } else { await api.deleteTag(item.id); tags.reload(); }
      toast(`${kind === 'campaign' ? 'Campaign' : 'Tag'} deleted.`);
    } catch (err) { toast((err as Error).message, 'error'); }
  }

  return (
    <>
      <div className="page-head"><div><h1>Campaigns &amp; Tags</h1><p className="sub">Organise links and compare performance.</p></div>
        <span className="spacer" /><button className="btn" onClick={() => setEdit('new')}><Icon name="plus" size={16} />New campaign</button></div>
      <div className="stack">
        <div className="card">
          <div className="card-head"><h2>Campaigns</h2></div>
          {camps.error ? <div className="card-pad"><ErrorBox error={camps.error} onRetry={camps.reload} /></div> : !camps.data ? <Spinner /> :
            camps.data.campaigns.length === 0 ? <Empty icon="folder" title="No campaigns yet" action={<button className="btn" onClick={() => setEdit('new')}>Create a campaign</button>}>Group related links — for example everything on one poster — and see their combined clicks.</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Name</th><th>UTM</th><th>Links</th><th>Clicks</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{camps.data.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b>{c.description && <div className="muted small">{c.description}</div>}</td>
                    <td className="small mono muted">{[c.utmSource && `source=${c.utmSource}`, c.utmMedium && `medium=${c.utmMedium}`, c.utmCampaign && `campaign=${c.utmCampaign}`].filter(Boolean).join(' · ') || '—'}</td>
                    <td><RLink to={`/links?campaignId=${c.id}`}>{fmtNum(c.linkCount)}</RLink></td>
                    <td>{fmtNum(c.totalClicks)}</td>
                    <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn secondary sm" onClick={() => setEdit(c)} aria-label={`Edit ${c.name}`}><Icon name="edit" size={14} /></button>
                      <button className="btn secondary sm" onClick={() => remove('campaign', c)} aria-label={`Delete ${c.name}`}><Icon name="trash" size={14} /></button></div></td>
                  </tr>))}</tbody></table></div>)}
        </div>
        <div className="card">
          <div className="card-head"><h2>Tags</h2></div>
          <div className="card-pad stack">
            <form className="row wrap" onSubmit={addTag} noValidate>
              <input className="input" style={{ flex: '1 1 200px', width: 'auto' }} placeholder="New tag name" aria-label="New tag name" value={tagName} maxLength={40} onChange={(e) => setTagName(e.target.value)} />
              <div className="row" role="radiogroup" aria-label="Tag colour">
                {COLORS.map((c) => <button type="button" key={c} role="radio" aria-checked={tagColor === c} aria-label={`Colour ${c}`} onClick={() => setTagColor(c)}
                  style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: tagColor === c ? '3px solid var(--text)' : '2px solid var(--surface)', cursor: 'pointer' }} />)}
              </div>
              <button className="btn">Add tag</button>
            </form>
            {tagError && <span className="field-error" role="alert">{tagError}</span>}
            {tags.error ? <ErrorBox error={tags.error} onRetry={tags.reload} /> : !tags.data ? <Spinner /> : tags.data.tags.length === 0 ? <p className="muted small">No tags yet. Tags are flexible labels like “print”, “social” or “team-a”.</p> : (
              <div className="row wrap">{tags.data.tags.map((t) => (
                <span key={t.id} className="tag-chip" style={{ padding: '4px 6px 4px 10px', fontSize: '.85rem' }}>
                  <span className="dot" style={{ background: t.color }} /><RLink to={`/links?tagId=${t.id}`}>{t.name}</RLink><span className="faint">{t.linkCount}</span>
                  <button className="btn ghost sm icon" style={{ minHeight: 24, width: 24 }} onClick={() => remove('tag', t)} aria-label={`Delete tag ${t.name}`}><Icon name="x" size={12} /></button>
                </span>))}</div>)}
          </div>
        </div>
      </div>
      {edit && <Modal title={edit === 'new' ? 'New campaign' : 'Edit campaign'} onClose={() => setEdit(null)}>
        <CampaignForm initial={edit === 'new' ? undefined : edit} onDone={() => { setEdit(null); camps.reload(); }} /></Modal>}
    </>
  );
}
