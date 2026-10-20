import { useEffect, useState } from 'react';
import { Link as RLink, useSearchParams } from 'react-router-dom';
import { api, type Campaign, type Link, type Tag } from '../api';
import { Icon } from '../components/Icon';
import { QrCode } from '../components/QrCode';
import { CopyButton, Empty, ErrorBox, Modal, SafetyBadge, Spinner, StatusBadge, fmtNum, relTime, useToast } from '../components/ui';
import { useDebounced, useLoad } from '../hooks';

export function Links() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const q = useDebounced(search, 300);
  const status = params.get('status') ?? 'all';
  const campaignId = params.get('campaignId') ?? '';
  const tagId = params.get('tagId') ?? '';
  const sort = params.get('sort') ?? 'newest';
  const page = Number(params.get('page') ?? 1);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [qrFor, setQrFor] = useState<Link | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.campaigns().then((r) => setCampaigns(r.campaigns)).catch(() => {});
    api.tags().then((r) => setTags(r.tags)).catch(() => {});
  }, []);
  useEffect(() => { if ((params.get('search') ?? '') !== q) update({ search: q, page: '' }); }, [q]);

  function update(patch: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v && v !== 'all' ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  }

  const list = useLoad(() => api.listLinks({ search: q, status: status === 'all' ? undefined : status, campaignId, tagId, sort, page, pageSize: 20 }),
    [q, status, campaignId, tagId, sort, page]);

  async function toggle(l: Link) {
    const next = l.status === 'active' ? 'disabled' : 'active';
    try {
      const r = await api.updateLink(l.id, { status: next });
      list.setData((d) => d && { ...d, links: d.links.map((x) => (x.id === l.id ? r.link : x)) });
      toast(next === 'disabled' ? 'Link disabled — visitors now see a “disabled” page.' : 'Link re-enabled.');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  const filtered = Boolean(q || status !== 'all' || campaignId || tagId);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <>
      <div className="page-head">
        <div><h1>My Links</h1><p className="sub">{list.data ? `${fmtNum(list.data.total)} link${list.data.total === 1 ? '' : 's'}${filtered ? ' match your filters' : ''}` : 'Loading…'}</p></div>
        <span className="spacer" />
        <RLink className="btn" to="/links/new"><Icon name="plus" size={16} />Create link</RLink>
      </div>
      <div className="card">
        <div className="toolbar" role="search">
          <input className="input" type="search" placeholder="Search by alias, title or destination…" aria-label="Search links" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="select" aria-label="Filter by status" value={status} onChange={(e) => update({ status: e.target.value, page: '' })}>
            <option value="all">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option>
            <option value="expired">Expired</option><option value="limit_reached">Limit reached</option><option value="blocked">Blocked</option>
          </select>
          <select className="select" aria-label="Filter by campaign" value={campaignId} onChange={(e) => update({ campaignId: e.target.value, page: '' })}>
            <option value="">All campaigns</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" aria-label="Filter by tag" value={tagId} onChange={(e) => update({ tagId: e.target.value, page: '' })}>
            <option value="">All tags</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="select" aria-label="Sort" value={sort} onChange={(e) => update({ sort: e.target.value })}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="most_clicks">Most clicks</option>
          </select>
        </div>
        {list.error ? <div className="card-pad"><ErrorBox error={list.error} onRetry={list.reload} /></div>
          : list.loading && !list.data ? <Spinner />
          : list.data!.links.length === 0 ? (
            filtered ? <Empty title="No links match" icon="link">Try a different search or clear the filters.</Empty>
              : <Empty title="No links yet" action={<RLink to="/links/new" className="btn">Create your first link</RLink>}>Short links you create will appear here.</Empty>
          ) : (
            <div aria-busy={list.loading}>
              {list.data!.links.map((l) => (
                <div key={l.id} className="link-row" data-testid="link-row">
                  <div className="link-main">
                    <div className="row" style={{ minWidth: 0 }}>
                      <RLink to={`/links/${l.id}`} className="link-short truncate">{l.shortUrl.replace(/^https?:\/\//, '')}</RLink>
                      {l.hasPassword && <span title="Password protected" className="faint"><Icon name="lock" size={14} /></span>}
                    </div>
                    {l.title && <span className="small truncate">{l.title}</span>}
                    <a href={l.destinationUrl} className="muted small truncate" target="_blank" rel="noopener noreferrer nofollow">{l.destinationUrl}</a>
                    <div className="link-meta">
                      <StatusBadge status={l.effectiveStatus} /><SafetyBadge status={l.safety.status} />
                      {l.campaign && <span className="badge brand">{l.campaign.name}</span>}
                      {l.tags.map((t) => <span key={t.id} className="tag-chip"><span className="dot" style={{ background: t.color }} />{t.name}</span>)}
                      <span>Created {relTime(l.createdAt)}</span>
                      {l.expiresAt && <span><Icon name="clock" size={12} /> {new Date(l.expiresAt) > new Date() ? 'Expires' : 'Expired'} {relTime(l.expiresAt)}</span>}
                    </div>
                  </div>
                  <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
                    <span className="clicks"><b>{fmtNum(l.clickCount)}{l.maxClicks ? <span className="faint small"> / {fmtNum(l.maxClicks)}</span> : null}</b><span className="faint small">clicks</span></span>
                    <div className="link-actions">
                      <CopyButton text={l.shortUrl} />
                      <button className="btn secondary sm" onClick={() => setQrFor(l)} aria-label={`QR code for ${l.code}`}><Icon name="qr" size={15} /></button>
                      <RLink className="btn secondary sm" to={`/links/${l.id}?edit=1`} aria-label={`Edit ${l.code}`}><Icon name="edit" size={15} /></RLink>
                      <button className="btn secondary sm" onClick={() => toggle(l)} aria-label={`${l.status === 'active' ? 'Disable' : 'Enable'} ${l.code}`}
                        title={l.status === 'active' ? 'Disable' : 'Enable'}><Icon name="power" size={15} />{l.status === 'active' ? 'Disable' : 'Enable'}</button>
                    </div>
                  </div>
                </div>
              ))}
              {pages > 1 && (
                <div className="pager">
                  <span className="muted small">Page {page} of {pages}</span>
                  <button className="btn secondary sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Previous</button>
                  <button className="btn secondary sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>Next</button>
                </div>
              )}
            </div>
          )}
      </div>
      {qrFor && <Modal title={`QR code · /${qrFor.code}`} onClose={() => setQrFor(null)}><QrCode url={qrFor.shortUrl} code={qrFor.code} /></Modal>}
    </>
  );
}
