import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, LogOut, ShieldCheck, UserRound, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, AUTH_TOKEN_KEY } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import './account-page.css';

const AUTH_ENABLED = import.meta.env.VITE_REQUIRE_AUTH === 'true';

export default function AccountPage() {
  const { notify } = useApp();
  const [mode, setMode] = useState('login');
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(AUTH_ENABLED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!AUTH_ENABLED) { setChecking(false); return undefined; }
    let active = true;
    api.get('/auth/me', { fallbackGraceMs: 0 }).then((value) => { if (active) setUser(value); })
      .catch(() => { try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* storage unavailable */ } })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login' ? { email: email.trim(), password } : { email: email.trim(), full_name: fullName.trim(), password };
      const result = await api.post(endpoint, body, { fallbackGraceMs: 0 });
      localStorage.setItem(AUTH_TOKEN_KEY, result.access_token);
      setUser(result.user); setPassword(''); notify(mode === 'login' ? 'Signed in successfully.' : 'Citizen account created.');
    } catch (reason) { setError(reason?.message || 'Account request failed. Please retry.'); }
    finally { setBusy(false); }
  }

  function signOut() {
    try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* storage unavailable */ }
    setUser(null); setPassword(''); notify('You have signed out.');
  }

  if (!AUTH_ENABLED) return <div className="account-page"><section className="account-hero"><div className="account-mark"><ShieldCheck size={22}/></div><span className="account-overline">CITIZEN ACCOUNT</span><h1>One account for your journeys.</h1><p>Trip history and saved mobility activity are protected behind production sign-in.</p><div className="account-setup-note"><b>Authentication is not enabled in this deployment.</b><span>Set AUTH_ENABLED=true in the backend and VITE_REQUIRE_AUTH=true in the frontend after configuring a secure JWT secret. Local demo mode remains available for development.</span></div><Link className="account-back-link" to="/citizen">Back to citizen home <ArrowRight size={15}/></Link></section></div>;

  if (checking) return <div className="account-page"><section className="account-card"><div className="account-mark"><ShieldCheck size={22}/></div><h2>Checking your account</h2><p>Verifying the current sign-in session.</p></section></div>;

  if (user) return <div className="account-page"><section className="account-card account-profile"><div className="account-mark"><UserRound size={22}/></div><span className="account-overline">SIGNED IN</span><h1>{user.full_name || 'UrbanSaarthi user'}</h1><p>{user.email}</p><div className="account-role"><span>Access level</span><b>{user.role}</b></div><div className="account-actions"><Link className="account-submit" to="/citizen/trips">View my trips <ArrowRight size={16}/></Link><button className="account-secondary" onClick={signOut}><LogOut size={16}/> Sign out</button></div></section></div>;

  return <div className="account-page"><section className="account-hero"><div className="account-mark"><KeyRound size={22}/></div><span className="account-overline">CITIZEN ACCOUNT</span><h1>{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h1><p>{mode === 'login' ? 'Sign in to see your saved routes and trip history.' : 'Create a citizen account to keep your journeys in sync.'}</p></section><form className="account-card" onSubmit={submit}>
    <div className="account-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Create account</button></div>
    {mode === 'register' && <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name"/></label>}
    <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
    <label>Password<input required type="password" minLength={mode === 'register' ? 12 : 1} maxLength={256} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? 'At least 12 characters' : 'Your password'}/></label>
    {error && <div className="account-error" role="alert">{error}</div>}
    <button className="account-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in securely' : 'Create citizen account'} <ArrowRight size={16}/></button>
    {mode === 'register' && <small className="account-footnote"><UserPlus size={14}/> New accounts are created with citizen access only. Administrative roles require a separately provisioned account.</small>}
  </form></div>;
}
