import { useEffect, useState } from 'react';
import { Check, Moon, Save, Settings, Sun, Users } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { ErrorNotice } from '../../components/shared/Toast.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';

export default function SettingsPage() {
  const { dark, setDark, language, toggleLanguage, user, updateUser, notify } = useApp();
  const [name, setName] = useState(user?.full_name || '');
  const [saving, setSaving] = useState(false);
  const { data: profile, loading, error, reload } = useApiResource(() => api.get(endpoints.me), []);
  useEffect(() => { if (profile?.full_name) setName(profile.full_name); }, [profile]);
  async function save() {
    setSaving(true);
    try {
      const updated = await api.patch(endpoints.me, { full_name: name, preferences: { theme: dark ? 'dark' : 'light', language } });
      updateUser(updated);
      notify('Profile and preferences saved through the API.'); reload();
    } catch (err) { notify(err.message); }
    finally { setSaving(false); }
  }
  return <>
    <PageIntro eyebrow="PREFERENCES" title="Settings" description="Manage your operator profile, appearance and language preferences." />
    <ErrorNotice message={error} onRetry={reload}/>
    <section className="panel settings-panel"><h3><Users size={17}/> Operator profile</h3><div className="setting-row"><div><b>Full name</b><small>Profile information from the connected backend.</small></div><input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={loading ? 'Loading profile…' : 'Full name'} /></div><div className="setting-row"><div><b>Account role</b><small>Access level assigned by an administrator.</small></div><span className="setting-value">{profile?.role || user?.role || 'Not signed in'}</span></div><div className="setting-row"><div><b>Appearance</b><small>Use light surfaces or the deep green dark theme.</small></div><button className="utility" onClick={() => setDark(!dark)}>{dark ? <Sun size={15}/> : <Moon size={15}/>} {dark ? 'Light theme' : 'Dark theme'}</button></div><div className="setting-row"><div><b>Language</b><small>English / हिंदी preference.</small></div><button className="utility" onClick={toggleLanguage}>{language === 'EN' ? 'Switch to हिंदी' : 'Switch to English'}</button></div><div className="setting-row"><div><b>Backend connection</b><small>API base URL is loaded from VITE_API_BASE_URL.</small></div><span className="connected"><i/>{import.meta.env.VITE_API_BASE_URL ? 'Configured' : 'Local default'}</span></div><button className="primary" onClick={save} disabled={saving}><Save size={15}/>{saving ? 'Saving…' : 'Save profile & preferences'}</button></section>
  </>;
}
