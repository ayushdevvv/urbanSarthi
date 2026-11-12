import { Moon, Settings, Sun, Users, ShieldCheck, Server, Activity, ExternalLink } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { useApp } from '../../context/AppContext.jsx';
import { api, API_BASE_URL } from '../../services/api/client.js';

const secured = import.meta.env.VITE_REQUIRE_AUTH === 'true';
export default function SettingsPage() {
  const { dark, setDark, language, toggleLanguage } = useApp();
  const { data: integrations, loading, reload } = useApiResource(() => api.get('/integrations/status'), []);
  const providers = integrations?.providers || {};
  const configured = Object.values(providers).filter((provider) => provider.configured).length;
  return <>
    <PageIntro eyebrow="WORKSPACE CONFIGURATION" title="Settings" description="Control the workspace appearance and review the security and provider configuration of this deployment." />
    <section className="panel settings-panel premium-settings">
      <h3><ShieldCheck size={17}/> Security & access</h3>
      <div className="setting-row"><div><b>Authority authentication</b><small>Frontend route gate. The backend independently enforces bearer tokens on protected routes.</small></div><span className={`integration-state ${secured ? 'ready' : 'setup'}`}><i/>{secured ? 'Enabled' : 'Disabled'}</span></div>
      <div className="setting-row"><div><b>Environment requirement</b><small>Production backend requires PostgreSQL, AUTH_ENABLED, a strong JWT secret, explicit CORS origins and an ingestion key.</small></div><span className="setting-value">Production-secure configuration</span></div>
      <div className="setting-row"><div><b>Citizen accounts</b><small>Citizen sign-in and registration are available when production authentication is enabled.</small></div><a className="setting-link" href="/citizen/account">Open account page <ExternalLink size={13}/></a></div>
      <div className="setting-row"><div><b>Appearance</b><small>Use light surfaces or the deep green dark theme.</small></div><button className="utility" onClick={() => setDark(!dark)}>{dark ? <Sun size={15}/> : <Moon size={15}/>} {dark ? 'Light theme' : 'Dark theme'}</button></div>
      <div className="setting-row"><div><b>Language</b><small>English / हिंदी preference.</small></div><button className="utility" onClick={toggleLanguage}>{language === 'EN' ? 'Switch to हिंदी' : 'Switch to English'}</button></div>
      <div className="setting-row"><div><b>Backend API</b><small>Configured API base URL for the frontend.</small></div><span className="setting-value">{API_BASE_URL}</span></div>
      <p className="api-note">Appearance and language are local preferences. Do not store provider secrets in the browser or source registry. Secrets belong only in the backend hosting environment or edge-device secret store.</p>
    </section>
    <section className="panel settings-panel premium-settings"><div className="panel-head"><div><h3><Server size={17}/> Provider readiness</h3><small>Live backend configuration and runtime checks.</small></div><button className="utility" onClick={reload} disabled={loading}><Activity size={14}/> Refresh</button></div>
      {!integrations ? <div className="setting-row"><span>{loading ? 'Checking integrations…' : 'Provider status could not be loaded. Check operator access and retry.'}</span></div> : <><div className="setting-row"><div><b>Configured integrations</b><small>Configured does not always mean healthy; device freshness is shown in Data Sources.</small></div><b>{configured} / {Object.keys(providers).length}</b></div><div className="setting-provider-list">{Object.entries(providers).map(([key, item]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><b className={item.configured ? 'is-ready' : 'is-missing'}>{item.configured ? item.mode || 'Configured' : 'Setup required'}</b></div>)}</div></>}
    </section>
  </>;
}
