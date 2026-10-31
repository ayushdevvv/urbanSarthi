import { useEffect, useMemo, useState } from 'react';
import { Clock3, WifiOff, X } from 'lucide-react';

export default function DataStatusBanner() {
  // Do not hydrate outage notices from the previous browser session. A notice is
  // shown only after a request in this session actually fails.
  const [events, setEvents] = useState({});
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const onStatus = (event) => {
      const detail = event.detail || {};
      setEvents((current) => {
        const next = { ...current };
        if (detail.type === 'fresh') delete next[detail.path];
        else if (detail.path) next[detail.path] = { ...detail, updatedAt: Date.now() };
        return next;
      });
      setDismissed(false);
    };
    window.addEventListener('urbansaarthi:data-status', onStatus);
    return () => window.removeEventListener('urbansaarthi:data-status', onStatus);
  }, []);
  const status = useMemo(() => Object.values(events).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null, [events]);
  const snapshot = useMemo(() => Object.values(events).filter((item) => item.type === 'snapshot').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null, [events]);
  if (!status || dismissed) return null;
  const hasSnapshot = Boolean(snapshot);
  const hasProvider = status.type === 'provider';
  const timestamp = snapshot?.cachedAt ? new Date(snapshot.cachedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  return <div className="data-status-banner" role="status">
    {hasSnapshot || hasProvider ? <Clock3 size={16}/> : <WifiOff size={16}/>}
    <span><b>{hasSnapshot ? 'Showing your last saved update' : hasProvider ? 'Using a direct air-quality provider' : 'Refresh connection unavailable'}</b><small>{hasSnapshot ? `Last successfully saved at ${timestamp || 'an earlier time'}. The view will refresh when the service reconnects.` : hasProvider ? 'The platform API was unavailable, so the forecast was retrieved directly from Open-Meteo.' : 'No new reading could be retrieved. Previously loaded information remains available; service-dependent actions are paused.'}</small></span>
    <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss connection message"><X size={15}/></button>
  </div>;
}
