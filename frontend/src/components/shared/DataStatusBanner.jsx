import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Clock3, WifiOff, X } from 'lucide-react';

export default function DataStatusBanner() {
  const location = useLocation();
  const [statuses, setStatuses] = useState({});
  const [dismissed, setDismissed] = useState(false);
  const latestRequestByPath = useRef({});

  useEffect(() => {
    setStatuses({});
    setDismissed(false);
    const onStatus = (event) => {
      const detail = event.detail || {};
      if (detail.routePath && detail.routePath !== location.pathname) return;
      const key = detail.path || detail.type || 'connection';
      const requestId = Number(detail.requestId || 0);
      if (requestId && requestId < (latestRequestByPath.current[key] || 0)) return;
      if (requestId) latestRequestByPath.current[key] = requestId;

      if (!detail.path) return;
      // Keep an independent state per endpoint. A healthy AQI request must not
      // erase an outage from a separate traffic request, and a pending retry
      // must clear only that endpoint's previous warning.
      setStatuses((current) => {
        const next = { ...current };
        if (detail.type === 'pending' || detail.type === 'fresh') delete next[key];
        else next[key] = { ...detail, updatedAt: Date.now() };
        return next;
      });
      setDismissed(false);
    };
    window.addEventListener('urbansaarthi:data-status', onStatus);
    return () => window.removeEventListener('urbansaarthi:data-status', onStatus);
  }, [location.pathname]);

  const status = Object.values(statuses).sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))[0];
  // The authority AQI workspace has its own provider fallback and per-source states.
  // Avoid surfacing unrelated station/hotspot API retries as a page-wide outage.
  if (location.pathname === '/authority/air-intelligence' || location.pathname === '/authority/aqi-forecast') return null;
  if (!status || dismissed) return null;
  const hasSnapshot = status.type === 'snapshot';
  const hasProvider = status.type === 'provider';
  const timestamp = hasSnapshot && status.cachedAt
    ? new Date(status.cachedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

  return <div className={`data-status-banner ${hasSnapshot ? 'is-snapshot' : hasProvider ? 'is-provider' : 'is-offline'}`} role="status" aria-live="polite">
    {hasSnapshot || hasProvider ? <Clock3 size={17} /> : <WifiOff size={17} />}
    <span>
      <b>{hasSnapshot ? 'Showing the latest saved information' : hasProvider ? 'Air-quality outlook available' : 'Live data is temporarily delayed'}</b>
      <small>{hasSnapshot
        ? `Saved ${timestamp || 'earlier'}. Live updates will resume when the service reconnects.`
        : hasProvider
          ? 'The outlook is sourced directly from the configured air-quality provider. Model values are not ground-station measurements.'
          : 'The latest feed could not be refreshed. Previously loaded information remains visible where available.'}</small>
    </span>
    <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss connection message"><X size={16} /></button>
  </div>;
}
