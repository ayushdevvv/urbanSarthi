import { ArrowRight, Building2, Cloud, Leaf, MapPin, Navigation, ShieldCheck, Wind } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext.jsx';
import BrandMark from '../../components/shared/BrandMark.jsx';

export default function PortalLanding() {
  const navigate = useNavigate();
  const { dark, setDark, language, toggleLanguage } = useApp();
  return <div className={`portal-landing ${dark ? 'dark' : ''}`}>
    <div className="national-stripe"><span/><span/><span/></div>
    <header className="landing-header"><button className="citizen-brand-button" onClick={() => navigate('/')}><BrandMark/></button><div className="landing-header-actions"><span>Current city: Delhi NCR</span><button className="utility" onClick={() => setDark(!dark)}><Cloud size={15}/>{dark ? 'Light' : 'Dark'}</button><button className="utility" onClick={toggleLanguage}><span className="hindi">हि</span>{language === 'EN' ? 'हिंदी' : 'English'}</button></div></header>
    <main className="landing-main"><section className="landing-copy"><span className="landing-kicker"><Leaf size={13}/> ONE CITY. ONE INTELLIGENT PULSE.</span><h1>Move better.<br/><em>Breathe easier.</em></h1><p>Real-time traffic, cleaner routes and coordinated city action — built for everyone who moves through India’s cities.</p><div className="portal-choice-label">CHOOSE A PORTAL</div><div className="portal-choices"><button className="portal-choice citizen-choice" onClick={() => navigate('/citizen')}><span className="choice-icon"><Navigation size={21}/></span><span><small>FOR RESIDENTS & COMMUTERS</small><b>Citizen portal</b></span><ArrowRight size={18}/></button><button className="portal-choice" onClick={() => navigate('/authority/control')}><span className="choice-icon"><Building2 size={20}/></span><span><small>FOR GOVERNMENT AGENCIES</small><b>Authority portal</b></span><ArrowRight size={18}/></button></div><div className="landing-assurances"><span><ShieldCheck size={13}/> Direct demo access</span><span><MapPin size={13}/> Multi-city India network</span><span><Wind size={13}/> AQI data when available</span></div></section>
      <section className="landing-visual" aria-label="City mobility preview"><div className="night-city-image"/><div className="night-overlay"/><div className="float-card deploy-card"><span className="live-dot"/> <small>CURRENT CITY · DELHI NCR</small><b>City mobility overview</b><p>API endpoint configured</p></div><div className="float-card delay-card"><small>Average delay</small><b>—</b><span>Awaiting traffic observations</span></div><div className="float-card network-card"><small>India network</small><b>Multi-city</b><span>City selection is available in the portal</span></div><div className="visual-grid-lines"/></section></main>
    <footer className="landing-footer"><span>UrbanSaarthi India · Multi-city platform</span><span>Aligned with India’s Smart Cities Mission</span><span>Emergency: 112</span></footer>
  </div>;
}
