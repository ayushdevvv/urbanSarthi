import { Moon, Settings, Sun, Server, Activity, RadioTower, Info } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { useApp } from '../../context/AppContext.jsx';
import { api, API_BASE_URL } from '../../services/api/client.js';

export default function SettingsPage() {
  const { dark, setDark, language, toggleLanguage } = useApp();
  const { data: integrations, loading, reload } = useApiResource(() => api.get('/integrations/status'), []);
  const providers = integrations?.providers || {};
  const configured = Object.values(providers).filter((provider) => provider.configured).length;
  return <>
    <PageIntro eyebrow="WORKSPACE CONFIGURATION" title="Settings" description="Review this public hackathon workspace, its connected providers and display preferences." />
    <section className="panel settings-panel premium-settings">
      <h3><Info size={17}/> Hackathon access</h3>
      <div className="setting-row"><div><b>Public demo workspace</b><small>No citizen or operator login is required. Visitors can explore the citizen portal and authority console.</small></div><span className="integration-state ready"><i/>Open access</span></div>
      <div className="setting-row"><div><b>Device ingestion</b><small>IoT and edge-camera ingestion remains protected with a separate X-Ingestion-Key. Never expose that key in browser code.</small></div><span className="integration-state ready"><i/>Key protected</span></div>
      <div className="setting-row"><div><b>Appearance</b><small>Use light surfaces or the deep green dark theme.</small></div><button className="utility" onClick={() => setDark(!dark)}>{dark ? <Sun size={15}/> : <Moon size={15}/>} {dark ? 'Light theme' : 'Dark theme'}</button></div>
      <div className="setting-row"><div><b>Language</b><small>English / हिंदी preference.</small></div><button className="utility" onClick={toggleLanguage}>{language === 'EN' ? 'Switch to हिंदी' : 'Switch to English'}</button></div>
      <div className="setting-row"><div><b>Backend API</b><small>Configured API base URL for the frontend.</small></div><span className="setting-value">{API_BASE_URL}</span></div>
      <p className="api-note">This public mode is intended for a hackathon demonstration, not a permanent production authority system. Keep provider and ingestion secrets only in Render environment variables.</p>
    </section>
    <section className="panel settings-panel premium-settings"><div className="panel-head"><div><h3><Server size={17}/> Provider readiness</h3><small>Live backend configuration and runtime checks.</small></div><button className="utility" onClick={reload} disabled={loading}><Activity size={14}/> Refresh</button></div>
      {!integrations ? <div className="setting-row"><span>{loading ? 'Checking integrations…' : 'Provider status could not be loaded. Check the backend connection and retry.'}</span></div> : <><div className="setting-row"><div><b>Configured integrations</b><small>Configured does not always mean healthy; device freshness is shown in Data Sources.</small></div><b>{configured} / {Object.keys(providers).length}</b></div><div className="setting-provider-list">{Object.entries(providers).map(([key, item]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><b className={item.configured ? 'is-ready' : 'is-missing'}>{item.configured ? item.mode || 'Configured' : 'Setup required'}</b></div>)}</div></>}
    </section>
  </>;
}
