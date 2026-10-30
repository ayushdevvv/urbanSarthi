import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Activity, Bus, Camera, House, MapPin, Moon, Route, Sun, Wind } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import BrandMark from '../shared/BrandMark.jsx';
import FloatingAgentWidget from '../shared/FloatingAgentWidget.jsx';

const links = [
  { to: '/citizen', label: 'Home', icon: House, end: true },
  { to: '/citizen/air-quality', label: 'Air quality', icon: Activity },
  { to: '/citizen/aqi-vision', label: 'Predict AQI', icon: Wind },
  { to: '/citizen/traffic', label: 'Traffic conditions', icon: Camera },
  { to: '/citizen/transit', label: 'Public transport', icon: Bus },
  { to: '/citizen/trips', label: 'My trips', icon: MapPin },
];
export default function CitizenLayout() {
  const { dark, setDark, language, toggleLanguage } = useApp();
  const navigate = useNavigate();
  return <div className={`citizen-app ${dark ? 'dark' : ''}`}>
    <header className="citizen-header">
      <button className="citizen-brand-button" onClick={() => navigate('/citizen')}><BrandMark /></button>
      <nav className="citizen-nav">{links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `citizen-nav-item ${isActive ? 'active' : ''}`}><Icon size={16}/>{label}</NavLink>)}</nav>
      <div className="citizen-actions">
        <button className="utility" onClick={() => setDark(!dark)}>{dark ? <Sun size={15}/> : <Moon size={15}/>} {dark ? 'Light' : 'Dark'}</button>
        <button className="utility" onClick={toggleLanguage}><span className="hindi">हि</span>{language === 'EN' ? 'हिंदी' : 'English'}</button>
        <button className="utility" onClick={() => navigate('/')}><House size={15}/> Main portal</button>
        <button className="citizen-avatar" title="UrbanSaarthi portal" onClick={() => navigate('/citizen')}>US</button>
      </div>
    </header>
    <main className="citizen-content"><Outlet /></main>
    <footer className="citizen-footer"><span>UrbanSaarthi · India</span><span>Air quality & traffic monitoring</span><span>Emergency: 112</span></footer>
    <FloatingAgentWidget mode="citizen" />
  </div>;
}
