import { Moon, Settings, Sun, Users } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { API_BASE_URL } from '../../services/api/client.js';

export default function SettingsPage() {
  const { dark, setDark, language, toggleLanguage } = useApp();
  return <>
    <PageIntro eyebrow="PREFERENCES" title="Settings" description="Platform preferences. No account or sign in is required." />
    <section className="panel settings-panel">
      <h3><Users size={17}/> Shared workspace</h3>
      <div className="setting-row"><div><b>Access mode</b><small>Citizen and authority portals are available without sign-in.</small></div><span className="setting-value">Public access · No sign-in</span></div>
      <div className="setting-row"><div><b>Appearance</b><small>Use light surfaces or the deep green dark theme.</small></div><button className="utility" onClick={() => setDark(!dark)}>{dark ? <Sun size={15}/> : <Moon size={15}/>} {dark ? 'Light theme' : 'Dark theme'}</button></div>
      <div className="setting-row"><div><b>Language</b><small>English / हिंदी preference.</small></div><button className="utility" onClick={toggleLanguage}>{language === 'EN' ? 'Switch to हिंदी' : 'Switch to English'}</button></div>
      <div className="setting-row"><div><b>Backend API</b><small>Configured API base URL for the frontend.</small></div><span className="connected"><i/>{API_BASE_URL}</span></div>
      <p className="api-note">This workspace is currently unauthenticated. Keep private operational data and credentials out of it until access controls are enabled.</p>
    </section>
  </>;
}
