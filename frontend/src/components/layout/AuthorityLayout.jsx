import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Bell, Camera, ChevronRight, House, Leaf, Menu, Moon, RadioTower, Sun, Wind, Network } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import BrandMark from '../shared/BrandMark.jsx';
import FloatingAgentWidget from '../shared/FloatingAgentWidget.jsx';
import DataStatusBanner from '../shared/DataStatusBanner.jsx';
import WorkspaceErrorBoundary from '../shared/WorkspaceErrorBoundary.jsx';

const navGroups = [
  { label: 'OVERVIEW', items: [
    { label: 'Overview', to: '/authority/control', icon: Activity },
  ]},
  { label: 'TRAFFIC', items: [
    { label: 'Traffic Lab', to: '/authority/traffic-lab', icon: Camera },
    { label: 'Traffic Simulation', to: '/authority/traffic-simulation', icon: Activity },
    { label: 'Digital Twin', to: '/authority/digital-twin', icon: Network },
  ]},
  { label: 'AIR QUALITY', items: [
    { label: 'AQI Forecast', to: '/authority/aqi-forecast', icon: Wind },
    { label: 'CO₂ Emissions', to: '/authority/carbon', icon: Leaf },
  ]},
  { label: 'FIELD NETWORK', items: [
    { label: 'IoT sensor network', to: '/authority/iot', icon: RadioTower },
  ]},
];
const meta = {
  '/authority/control': ['Overview', 'Overview'],
  '/authority/traffic-lab': ['Traffic', 'Traffic Lab'],
  '/authority/traffic-agent': ['Traffic', 'Traffic agent'],
  '/authority/digital-twin': ['Traffic', 'Digital Twin'],
  '/authority/air-intelligence': ['Air quality', 'AQI overview'],
  '/authority/aqi-forecast': ['Air quality', 'AQI Forecast'],
  '/authority/traffic-simulation': ['Traffic', 'Traffic Simulation'],
  '/authority/carbon': ['Air quality', 'CO₂ Emissions'],
  '/authority/iot': ['Field network', 'IoT sensor network'],
  '/authority/analytics': ['Insights', 'City analytics'],
  '/authority/sources': ['Manage', 'Data sources'],
  '/authority/settings': ['Manage', 'Settings'],
};
export default function AuthorityLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dark, setDark, language, toggleLanguage } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  const [crumb, title] = meta[location.pathname] || meta['/authority/control'];
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
      <div className="sidebar-monitor-note"><span className="sidebar-monitor-icon"><Wind size={16}/></span><div><b>City monitoring</b><small>Traffic · air quality · field network</small></div></div>
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
        <button className="icon-btn" aria-label="Alerts" onClick={() => navigate('/authority/air-intelligence')}><Bell size={18}/></button>
      </div>
    </header><div className="content"><DataStatusBanner/><WorkspaceErrorBoundary key={location.pathname}><Outlet /></WorkspaceErrorBoundary></div></main>
    <FloatingAgentWidget mode="authority" />
  </div>;
}
