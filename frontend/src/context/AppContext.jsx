import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Start every fresh session in UrbanSaarthi's light-green visual system.
  // Dark mode remains an explicit in-session preference, never an old cached default.
  const [dark, setDarkState] = useState(false);
  const [language, setLanguage] = useState(() => localStorage.getItem('us_language') || 'EN');
  const [toast, setToast] = useState('');
  const setDark = (next) => setDarkState(Boolean(next));
  const toggleLanguage = () => setLanguage((current) => { const next = current === 'EN' ? 'HI' : 'EN'; localStorage.setItem('us_language', next); return next; });
  const notify = useCallback((message) => { setToast(message); window.clearTimeout(notify.timer); notify.timer = window.setTimeout(() => setToast(''), 3200); }, []);
  const value = useMemo(() => ({ dark, setDark, language, toggleLanguage, toast, notify }), [dark, language, toast, notify]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
