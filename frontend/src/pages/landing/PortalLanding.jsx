import { ArrowRight, Bot, Building2, Cloud, Leaf, MapPin, Navigation, ShieldCheck, Wind, Activity, TrendingUp, CarFront } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext.jsx';
import BrandMark from '../../components/shared/BrandMark.jsx';

const snapshot = { vehicles: 1408, queue: 1350, forecast: 1475, roads: 80, accuracy: 83.4 };

export default function PortalLanding() {
  const navigate = useNavigate();
  const { dark, setDark, language, toggleLanguage } = useApp();
  return <div className={`portal-landing ${dark ? 'dark' : ''}`}>
    <div className="national-stripe"><span/><span/><span/></div>
    <header className="landing-header">
      <button className="citizen-brand-button" onClick={() => navigate('/')} aria-label="UrbanSaarthi home"><BrandMark/></button>
      <div className="landing-header-actions"><span>City view: Delhi NCR</span><button className="utility" onClick={() => setDark(!dark)}><Cloud size={15}/>{dark ? 'Light' : 'Dark'}</button><button className="utility" onClick={toggleLanguage}><span className="hindi">हि</span>{language === 'EN' ? 'हिंदी' : 'English'}</button></div>
    </header>
    <main className="landing-main">
      <section className="landing-copy">
        <span className="landing-kicker"><Leaf size={14}/> A SMARTER WAY THROUGH THE CITY</span>
        <h1>Move better.<br/><em>Breathe easier.</em></h1>
        <p>One calm place to explore road conditions, plan cleaner journeys, check air quality and understand how the city moves.</p>
        <div className="portal-choice-label">CHOOSE YOUR EXPERIENCE</div>
        <div className="portal-choices">
          <button className="portal-choice citizen-choice" onClick={() => navigate('/citizen')}><span className="choice-icon"><Navigation size={21}/></span><span><small>FOR EVERYDAY JOURNEYS</small><b>Citizen portal</b></span><ArrowRight size={18}/></button>
          <button className="portal-choice authority-choice" onClick={() => navigate('/authority/control')}><span className="choice-icon"><Building2 size={20}/></span><span><small>FOR CITY OPERATIONS</small><b>Authority portal</b></span><ArrowRight size={18}/></button>
        </div>
        <div className="landing-assurances">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--brand, #0d9488)', fontWeight: 600 }}><Bot size={14}/> AI Mobility Assistant Active</span>
          <span><ShieldCheck size={14}/> Easy access</span>
          <span><MapPin size={14}/> Multi-city mobility</span>
          <span><Wind size={14}/> Air quality insights</span>
        </div>
      </section>
      <section className="landing-visual" aria-label="City mobility overview">
        <div className="city-glow city-glow-one"/><div className="city-glow city-glow-two"/>
        <div className="city-road city-road-main"/><div className="city-road city-road-cross"/>
        <div className="city-map-label"><span className="live-dot"/> CITY MODEL OVERVIEW <small>SUMO TRAFFIC FORECAST</small></div>
        <div className="float-card deploy-card"><small><Activity size={12}/> TRAFFIC SNAPSHOT</small><b>{snapshot.roads} road segments</b><p>Modelled city network</p></div>
        <div className="float-card delay-card"><small>Vehicles in latest model frame</small><b>{snapshot.vehicles.toLocaleString('en-IN')}</b><span>Simulation observations</span></div>
        <div className="float-card network-card"><small>Queue forecast in 30 minutes</small><b>{snapshot.forecast.toLocaleString('en-IN')}</b><span><TrendingUp size={12}/> {Math.round((snapshot.forecast - snapshot.queue)/snapshot.queue*100)}% above current queue</span></div>
        <div className="landing-model-footer"><span><CarFront size={14}/> Trained traffic model</span><span>{snapshot.accuracy}% level accuracy</span></div>
      </section>
    </main>
    <section className="landing-stats" aria-label="Traffic model summary">
      <article><span>Current network queue</span><b>{snapshot.queue.toLocaleString('en-IN')}</b><small>Vehicles halted in the supplied simulation run</small></article>
      <article><span>Expected queue</span><b>{snapshot.forecast.toLocaleString('en-IN')}</b><small>Model forecast 30 minutes ahead</small></article>
      <article><span>Road segments</span><b>{snapshot.roads}</b><small>Covered by the simulation network</small></article>
      <article><span>Model evaluation</span><b>{snapshot.accuracy}%</b><small>Congestion level accuracy on held out simulation runs</small></article>
    </section>
    <footer className="landing-footer"><span>UrbanSaarthi India</span><span>City mobility intelligence</span><span>Emergency: 112</span></footer>
  </div>;
}
