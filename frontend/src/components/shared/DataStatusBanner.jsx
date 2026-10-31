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
  if (!status || dismissed) return null;
  const hasSnapshot = status.type === 'snapshot';
  const hasProvider = status.type === 'provider';
  const timestamp = hasSnapshot && status.cachedAt
    ? new Date(status.cachedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

  return <div className={`data-status-banner ${hasSnapshot ? 'is-snapshot' : hasProvider ? 'is-provider' : 'is-offline'}`} role="status" aria-live="polite">
    {hasSnapshot || hasProvider ? <Clock3 size={17} /> : <WifiOff size={17} />}
    <span>
      <b>{hasSnapshot ? 'Showing the last successful update' : hasProvider ? 'Using the direct air-quality source' : 'Unable to refresh this page'}</b>
      <small>{hasSnapshot
        ? `Saved ${timestamp || 'earlier'}. Live updates will resume when the service reconnects.`
        : hasProvider
          ? 'The platform API was unavailable, so the forecast was retrieved directly from its configured provider.'
          : 'The latest request could not be completed. Existing page content has been kept where available.'}</small>
    </span>
    <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss connection message"><X size={16} /></button>
  </div>;
}
