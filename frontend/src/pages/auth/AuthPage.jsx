import { useState } from 'react';
import { ArrowLeft, LockKeyhole, LogIn, UserPlus } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import BrandMark from '../../components/shared/BrandMark.jsx';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

export default function AuthPage() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get('mode') === 'register' ? 'register' : 'login');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const navigate = useNavigate(); const { signIn, notify } = useApp();
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (mode === 'register') {
        await api.post(endpoints.register, { full_name: name, email, password });
        setMode('login'); notify('Account created. Sign in to continue.');
      } else {
        const result = await api.post(endpoints.login, { email, password });
        signIn(result.access_token, result.user); notify('Signed in successfully.');
        const redirect = params.get('next') || (result.user?.role === 'operator' || result.user?.role === 'admin' ? '/authority/control' : '/citizen');
        navigate(redirect);
      }
    } catch (err) { setError(err.message || 'Authentication failed'); }
    finally { setBusy(false); }
  }
  return <div className="auth-page"><div className="auth-card"><Link to="/" className="back-link"><ArrowLeft size={15}/> Main portal</Link><BrandMark/><div className="auth-heading"><span className="auth-symbol"><LockKeyhole size={19}/></span><h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1><p>Use the UrbanSaarthi backend account for protected mobility features.</p></div>
      <form onSubmit={submit} className="auth-form">{mode === 'register' && <label>Full name<input autoComplete="name" minLength={2} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name"/></label>}<label>Email address<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"/></label><label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : 1} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}/></label>
        {error && <div className="auth-error">{error}</div>}<button className="primary auth-submit" disabled={busy}>{mode === 'login' ? <LogIn size={16}/> : <UserPlus size={16}/ >}{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button></form>
      <p className="auth-switch">{mode === 'login' ? 'New to UrbanSaarthi?' : 'Already registered?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in instead'}</button></p><p className="auth-boundary">Citizens can register publicly. Operator and admin access must be assigned by an administrator.</p>
    </div></div>;
}
