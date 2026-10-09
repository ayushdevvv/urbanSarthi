import { createContext, useContext, useMemo, useState } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [dark, setDarkState] = useState(() => localStorage.getItem('us_theme') === 'dark');
  const [language, setLanguage] = useState(() => localStorage.getItem('us_language') || 'EN');
  const [toast, setToast] = useState('');
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('us_user') || 'null'); } catch { return null; }
  });
  const setDark = (next) => { setDarkState(next); localStorage.setItem('us_theme', next ? 'dark' : 'light'); };
  const toggleLanguage = () => setLanguage((current) => { const next = current === 'EN' ? 'HI' : 'EN'; localStorage.setItem('us_language', next); return next; });
  const notify = (message) => { setToast(message); window.clearTimeout(notify.timer); notify.timer = window.setTimeout(() => setToast(''), 3200); };
  const signIn = (token, profile) => { localStorage.setItem('us_token', token); localStorage.setItem('us_user', JSON.stringify(profile)); setUser(profile); };
  const updateUser = (profile) => { localStorage.setItem('us_user', JSON.stringify(profile)); setUser(profile); };
  const signOut = () => { localStorage.removeItem('us_token'); localStorage.removeItem('us_user'); setUser(null); };
  const value = useMemo(() => ({ dark, setDark, language, toggleLanguage, toast, notify, user, signIn, updateUser, signOut }), [dark, language, toast, user]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
