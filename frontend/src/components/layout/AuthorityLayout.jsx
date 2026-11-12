import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Bell, Bot, Camera, ChevronRight, Database, House, Leaf, LockKeyhole, LogOut, Menu, Moon, RadioTower, Settings, Sun, Wind, Route } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import BrandMark from '../shared/BrandMark.jsx';
import FloatingAgentWidget from '../shared/FloatingAgentWidget.jsx';
import DataStatusBanner from '../shared/DataStatusBanner.jsx';
import { api, AUTH_TOKEN_KEY } from '../../services/api/client.js';
import './authority-auth.css';

const navGroups = [
  { label: 'OVERVIEW', items: [
    { label: 'City overview', to: '/authority/control', icon: Activity },
  ]},
  { label: 'AIR QUALITY', items: [
    { label: 'AQI overview', to: '/authority/air-intelligence', icon: Wind },
    { label: 'Carbon & emissions', to: '/authority/carbon', icon: Leaf },
  ]},
  { label: 'FIELD NETWORK', items: [
    { label: 'IoT sensor network', to: '/authority/iot', icon: RadioTower },
    { label: 'Data sources', to: '/authority/sources', icon: Database },
  ]},
  { label: 'TRAFFIC', items: [
    { label: 'Camera system', to: '/authority/traffic-lab', icon: Camera },
    { label: 'Traffic agent', to: '/authority/traffic-agent', icon: Bot },
    { label: 'Traffic simulation', to: '/authority/traffic-simulation', icon: Route },
  ]},
  { label: 'INSIGHTS & SYSTEM', items: [
    { label: 'City analytics', to: '/authority/analytics', icon: Activity },
    { label: 'Settings', to: '/authority/settings', icon: Settings },
  ]},
];
const meta = {
  '/authority/control': ['Overview', 'City overview'],
  '/authority/traffic-lab': ['Traffic', 'Camera system'],
  '/authority/traffic-agent': ['Traffic', 'Traffic agent'],
  '/authority/air-intelligence': ['Air quality', 'AQI overview'],
  '/authority/aqi-forecast': ['Air quality', 'AQI forecasting'],
  '/authority/traffic-simulation': ['Traffic', '60-minute traffic simulation'],
  '/authority/iot': ['Field network', 'IoT sensor network'],
  '/authority/analytics': ['Insights', 'City analytics'],
  '/authority/sources': ['Manage', 'Data sources'],
  '/authority/settings': ['Manage', 'Settings'],
};
export default function AuthorityLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dark, setDark, language, toggleLanguage } = useApp();
  const requireAuth = import.meta.env.VITE_REQUIRE_AUTH === 'true';
  const [operator, setOperator] = useState(null);
  const [authChecking, setAuthChecking] = useState(requireAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!requireAuth) { setAuthChecking(false); return undefined; }
    let active = true;
    const token = (() => { try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; } })();
    if (!token) { setOperator(null); setAuthChecking(false); return undefined; }
    api.get('/auth/me', { fallbackGraceMs: 0 }).then((user) => {
      if (!active) return;
      if (['operator', 'admin'].includes(user?.role)) setOperator(user);
      else {
        try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* storage unavailable */ }
        setOperator(null);
        setAuthError('This account does not have authority access. Sign in with an authorized operator or administrator account.');
      }
    }).catch(() => {
      try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* storage unavailable */ }
      if (active) setOperator(null);
    }).finally(() => { if (active) setAuthChecking(false); });
    return () => { active = false; };
  }, [requireAuth]);

  async function signIn(event) {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    try {
      const response = await api.post('/auth/login', { email: email.trim(), password }, { fallbackGraceMs: 0 });
      if (!['operator', 'admin'].includes(response.user?.role)) {
        throw new Error('This account does not have authority access. Use a provisioned operator or administrator account.');
      }
      localStorage.setItem(AUTH_TOKEN_KEY, response.access_token);
      setOperator(response.user); setPassword('');
    } catch (err) { setAuthError(err?.message || 'Sign in failed. Check your credentials and retry.'); }
    finally { setAuthBusy(false); }
  }
  function signOut() {
    try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* storage unavailable */ }
    setOperator(null); setPassword(''); setAuthError('');
  }
  const [crumb, title] = meta[location.pathname] || meta['/authority/control'];
  if (requireAuth && authChecking) return <div className="authority-auth-screen"><div className="authority-auth-card"><div className="authority-auth-mark"><LockKeyhole size={22}/></div><h1>Securing your workspace</h1><p>Verifying your operator session.</p></div></div>;
  if (requireAuth && !operator) return <div className="authority-auth-screen"><form className="authority-auth-card" onSubmit={signIn}>
    <div className="authority-auth-brand"><BrandMark /></div><div className="authority-auth-overline">AUTHORITY ACCESS</div><h1>Sign in to operations</h1><p>Use an authorized UrbanSaarthi operator or administrator account.</p>
    <label>Email address<input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@city.gov.in" /></label>
    <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your account password" /></label>
    {authError && <div className="authority-auth-error">{authError}</div>}
    <button className="primary" type="submit" disabled={authBusy}>{authBusy ? 'Signing in…' : 'Continue to command centre'}</button>
    <small>Access is logged. Edge devices use a separate ingestion key.</small>
  </form></div>;
  return <div className={`app authority-app ${dark ? 'dark' : ''}`}>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside id="authority-sidebar" className={`sidebar ${mobileOpen ? 'show' : ''}`}>
      <BrandMark />
      <nav className="nav-area" aria-label="Authority navigation">{navGroups.map((group) => <section key={group.label}>
        <div className="nav-label">{group.label}</div>
        {group.items.map(({ label, to, icon: Icon }) => <NavLink end key={to} to={to} className={({ isActive }) => `nav-item ${isActive || (to === '/authority/air-intelligence' && location.pathname === '/authority/aqi-forecast') ? 'active' : ''}`} onClick={() => setMobileOpen(false)}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
        </NavLink>)}
      </section>)}</nav>
      <div className="sidebar-monitor-note"><span className="sidebar-monitor-icon"><Wind size={16}/></span><div><b>City monitoring</b><small>Air quality · field network · traffic</small></div></div>
      <div className="profile"><div className="avatar">US</div><div><b>UrbanSaarthi</b><small>Air quality & traffic operations</small></div><ChevronRight size={17}/></div>
      <button className="switch" onClick={() => navigate('/')}>← Switch portal</button>
    </aside>
    <main className="main"><header className="topbar">
      <button className="mobile-menu" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-controls="authority-sidebar" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Menu size={20}/></button>
      <div className="crumb"><small>UrbanSaarthi&nbsp; › &nbsp;{crumb}</small><h1>{title}</h1></div>
      <div className="top-actions"><div className="workspace-status"><i/><span>Monitoring workspace</span></div>
        <button className="utility" aria-label={dark ? 'Switch to light appearance' : 'Switch to dark appearance'} title={dark ? 'Switch to light appearance' : 'Switch to dark appearance'} onClick={() => setDark(!dark)}>{dark ? <Sun size={15}/> : <Moon size={15}/>} {dark ? 'Light' : 'Dark'}</button>
        <button className="utility" aria-label={language === 'EN' ? 'Switch language to Hindi' : 'Switch language to English'} onClick={toggleLanguage}><span className="hindi">हि</span>{language === 'EN' ? 'हिंदी' : 'English'}</button>
        <button className="utility" aria-label="Switch to main portal" onClick={() => navigate('/')}><House size={15}/> Main portal</button>
        {requireAuth && <button className="utility" aria-label="Sign out" onClick={signOut}><LogOut size={15}/> Sign out</button>}
        <button className="icon-btn" aria-label="Open operational alerts" title="Operational alerts" onClick={() => navigate('/authority/control')}><Bell size={18}/></button>
      </div>
    </header><div className="content"><DataStatusBanner/><Outlet /></div></main>
    <FloatingAgentWidget mode="authority" />
  </div>;
}
