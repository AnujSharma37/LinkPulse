import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { VerifyBanner } from './VerifyBanner';
import { Icon } from './Icon';
import { Spinner } from './ui';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: 'home' },
  { to: '/links', label: 'My Links', icon: 'link' },
  { to: '/analytics', label: 'Analytics', icon: 'chart' },
  { to: '/campaigns', label: 'Campaigns & Tags', icon: 'folder' },
];

export function Brand() {
  return <a className="brand" href="/"><img src="/favicon.svg" alt="" />LinkPulse</a>;
}

export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn ghost icon" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
        <Brand />
        <span className="spacer" />
        <NavLink to="/links/new" className="btn sm"><Icon name="plus" size={15} />New</NavLink>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <Brand />
        <NavLink to="/links/new" className="btn" style={{ marginBottom: 12 }}><Icon name="plus" size={16} />Create link</NavLink>
        <nav className="stack-sm" style={{ gap: 2 }}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/links'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="user">
          <div className="small truncate" title={user?.email}><b>{user?.displayName || 'Signed in'}</b><br /><span className="muted">{user?.email}</span></div>
          <button className="btn secondary sm" onClick={async () => { await logout(); nav('/login'); }}><Icon name="logout" size={15} />Log out</button>
        </div>
      </aside>
      <main className="main" id="main"><VerifyBanner /><Suspense fallback={<Spinner />}><Outlet /></Suspense></main>
    </div>
  );
}
