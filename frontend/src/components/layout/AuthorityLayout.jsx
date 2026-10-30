import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Bell, Bot, Camera, ChevronRight, HelpCircle, Database, House, Map, Menu, Moon, Settings, Sun, Wind, Zap, CloudSun } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import BrandMark from '../shared/BrandMark.jsx';
import FloatingAgentWidget from '../shared/FloatingAgentWidget.jsx';

const navGroups = [
  { label: 'WORKSPACE', items: [
    { label: 'Live control centre', to: '/authority/control', icon: Map, code: 'ICCC' },
    { label: 'Signal plans', to: '/authority/signals', icon: Zap },
    { label: 'Traffic Simulation', to: '/authority/traffic-model', icon: Activity },
    { label: 'Traffic Lab', to: '/authority/traffic-lab', icon: Camera },
    { label: 'HawaFlow AI', to: '/authority/air-intelligence', icon: CloudSun },
    { label: 'Analytics', to: '/authority/analytics', icon: BarChart3 },
  ]},
  { label: 'MANAGE', items: [
    { label: 'Air quality', to: '/authority/aqi', icon: Wind },
    { label: 'Data sources', to: '/authority/sources', icon: Database },
    { label: 'Settings', to: '/authority/settings', icon: Settings },
  ]},
];
const meta = {
  '/authority/control': ['Delhi ICCC', 'Live authority control centre'],
  '/authority/signals': ['Network control', 'Signal plans'],
  '/authority/traffic-model': ['Network operations', 'Traffic Simulation'],
  '/authority/traffic-lab': ['Network operations', 'Traffic Lab'],
  '/authority/air-intelligence': ['InnovateX · Theme 02', 'HawaFlow AI'],
  '/authority/aqi': ['Air & sensors', 'Air quality'],
  '/authority/analytics': ['Performance', 'City analytics'],
  '/authority/sources': ['Manage', 'Data sources'],
  '/authority/settings': ['Manage', 'Settings'],
};

export default function AuthorityLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dark, setDark, language, toggleLanguage, notify } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [crumb, title] = meta[location.pathname] || meta['/authority/control'];
  return <div className={`app authority-app ${dark ? 'dark' : ''}`}>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'show' : ''}`}>
      <BrandMark />
      <div className="nav-area">{navGroups.map((group) => <section key={group.label}>
        <div className="nav-label">{group.label}</div>
        {group.items.map(({ label, to, icon: Icon, code }) => <NavLink end key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setMobileOpen(false)}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{code && <em>{code}</em>}
        </NavLink>)}
      </section>)}</div>
      <div className="system"><div className="online-dot"/><b>API configuration</b><p>{(import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL) ? 'Custom API endpoint set' : 'Using local API default'}</p></div>
      <div className="profile"><div className="avatar">US</div><div><b>UrbanSaarthi Operations</b><small>Authority workspace</small></div><ChevronRight size={17}/></div>
      <button className="switch" onClick={() => navigate('/')}>← Switch portal</button>
    </aside>
    <main className="main"><header className="topbar">
      <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(!mobileOpen)}><Menu size={20}/></button>
      <div className="crumb"><small>Selected city&nbsp; › &nbsp;{crumb}</small><h1>{title}</h1></div>
      <div className="top-actions"><div className="weather"><Wind size={19}/><span><b>Weather feed</b><small>Not connected</small></span></div>
        <button className="utility" onClick={() => setDark(!dark)}>{dark ? <Sun size={15}/> : <Moon size={15}/>} {dark ? 'Light' : 'Dark'}</button>
        <button className="utility" onClick={toggleLanguage}><span className="hindi">हि</span>{language === 'EN' ? 'हिंदी' : 'English'}</button>
        <button className="utility" onClick={() => navigate('/')}><House size={15}/> Main portal</button>
        <button className="icon-btn" aria-label="Help" onClick={() => notify('UrbanSaarthi command centre help')}><HelpCircle size={18}/></button>
        <button className="icon-btn" aria-label="Alerts" onClick={() => navigate('/authority/control')}><Bell size={18}/></button>
      </div>
    </header><div className="content"><Outlet /></div></main>
    <FloatingAgentWidget mode="authority" />
  </div>;
}
