import { useMemo, useState } from 'react';
import { Activity, AirVent, Cloud, Database, Map, Plus, RefreshCw, Users, X, RadioTower, ShieldCheck, MapPin } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const humanAge = (s) => s == null ? 'No successful update' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} hr ago`;
const iconFor = (kind = '') => /air|aqi/i.test(kind) ? AirVent : /transit|bus|metro/i.test(kind) ? Users : /road|map|geo/i.test(kind) ? Map : /traffic|camera/i.test(kind) ? Map : Cloud;
export default function DataSourcesPage() {
  const { notify } = useApp();
  const { data, loading, error, reload } = useApiResource(() => api.get(endpoints.sourceHealth), []);
  const { data: integrations, reload: reloadIntegrations } = useApiResource(() => api.get('/integrations/status'), []);
  const [connectOpen, setConnectOpen] = useState(false);
  const [draft, setDraft] = useState({ external_id: '', name: '', source_type: 'other', provider: '', status: 'not_configured', freshness_seconds: '300' });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Only backend-registered records appear in this operational registry.
  // External capabilities are documented elsewhere and are not shown as connected devices.
  const sources = Array.isArray(data?.sources) ? data.sources.filter((source) => source.external_id !== 'synthetic-demo') : [];
  const counts = useMemo(() => sources.reduce((out, source) => { const status = source.status || 'unknown'; out[status] = (out[status] || 0) + 1; return out; }, {}), [sources]);
  const providers = integrations?.providers || {};
  const providerRows = [
    ['OpenAQ', 'openaq', 'Station pollutant concentrations'],
    ['TomTom Traffic', 'tomtom_traffic', 'Current road-flow conditions'],
    ['OpenWeather Air', 'openweather_air', 'Optional current conditions and forecast'],
    ['CPCB', 'cpcb', 'Authorized official AQI observation feed'],
    ['Camera processing', 'camera_vision', 'Secure camera analysis events'],
    ['Road simulation', 'sumo', 'Detailed road-network simulation'],
    ['GTFS', 'gtfs_static', 'Imported public-transit schedules'],
    ['Routing', 'routing', 'Road routing and geocoding'],
    ['Traffic controller', 'atcs_write_control', 'Physical signal writes remain disabled'],
  ];
  async function syncOpenAq() {
    if (!navigator.geolocation) { notify('Location access is not available in this browser.'); return; }
    setSyncing(true);
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }));
      const latitude = position.coords.latitude; const longitude = position.coords.longitude;
      const result = await api.post(`/integrations/openaq/sync?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&radius_km=20&max_locations=10`);
      notify(`OpenAQ sync completed: ${result.observations_created} station observations imported.`);
      await Promise.all([reload(), reloadIntegrations()]);
    } catch (err) { notify(err?.message || 'OpenAQ sync could not be completed.'); }
    finally { setSyncing(false); }
  }
  async function connectSource(event) {
    event.preventDefault(); setSaving(true);
    try { await api.post('/admin/data-sources', { ...draft, status: 'not_configured', freshness_seconds: draft.freshness_seconds === '' ? null : Number(draft.freshness_seconds), safe_config: {} }); notify('Source record saved through the backend. A record does not itself connect a live provider feed.'); setConnectOpen(false); setDraft({ external_id: '', name: '', source_type: 'other', provider: '', status: 'not_configured', freshness_seconds: '300' }); await reload(); }
    catch (err) { notify(err.message); } finally { setSaving(false); }
  }
  return <>
    <PageIntro eyebrow="CONNECTED SYSTEMS" title="Data sources" description="Monitor the configured feeds powering forecasts, routing and signal optimization." action={<button className="primary" onClick={() => setConnectOpen(true)}><Plus size={15}/> Register source</button>} />
    {integrations && <section className="panel integration-panel"><div className="panel-head"><div><div className="eyebrow">PROVIDER CONNECTIVITY</div><h3>Live integration status</h3><small>Credential and runtime checks from the backend, not manually selected status.</small></div><button className="utility" onClick={reloadIntegrations}><RefreshCw size={14}/> Refresh</button></div><div className="integration-grid">{providerRows.map(([label, key, description]) => { const item = providers[key] || {}; const configured = Boolean(item.configured); const live = item.healthy === true || item.status === 'ready'; const state = item.status === 'disabled' ? 'disabled' : item.status === 'stale' ? 'stale' : item.status === 'waiting_for_heartbeat' || item.status === 'waiting_for_feed' ? 'waiting' : live ? 'ready' : configured ? 'configured' : 'setup'; const stateLabel = state === 'ready' ? 'Fresh / ready' : state === 'stale' ? 'Stale feed' : state === 'waiting' ? 'Awaiting first feed' : state === 'configured' ? 'Configured · verify on use' : state === 'disabled' ? 'Intentionally disabled' : 'Setup required'; return <div className="integration-tile" key={key}><div className="integration-tile-icon">{key === 'camera_vision' ? <RadioTower size={17}/> : key === 'cpcb' ? <ShieldCheck size={17}/> : key === 'openaq' || key === 'openweather_air' ? <AirVent size={17}/> : key === 'sumo' ? <Activity size={17}/> : <Cloud size={17}/>}</div><div><b>{label}</b><small>{description}</small><span className={`integration-state ${state}`}><i/>{stateLabel}</span></div></div>; })}</div><div className="integration-actions">{providers.openaq?.configured ? <button className="primary" onClick={syncOpenAq} disabled={syncing}><MapPin size={15}/>{syncing ? 'Syncing nearby stations…' : 'Sync OpenAQ near my location'}</button> : <span className="api-note">Add OPENAQ_API_KEY to the backend environment to enable station discovery and synchronization.</span>}<span className="api-note">Browser location is requested only when you start a nearby station sync.</span></div></section>}
    {data && <div className="notice scenario-notice"><Activity size={14}/>Registered source records · health is driven by successful syncs and device heartbeats</div>}
    {data && <div className="health-banner"><div className="health-ring">{sources.length ? `${Math.round(((counts.online || 0) / sources.length) * 100)}%` : '—'}</div><div className="health-copy"><b>Configured source health</b><small>{data?.generated_at ? `Health checked ${new Date(data.generated_at).toLocaleString()}` : 'Health-check timestamp not supplied.'}</small></div><div className="health-stat"><b>{sources.length}</b><small>configured</small></div><div className="health-stat"><b>{counts.online || 0}</b><small>online</small></div><div className="health-stat"><b>{counts.stale || 0}</b><small>stale</small></div><div className="health-stat"><b>{counts.offline || 0}</b><small>offline</small></div></div>}
    {loading && !data ? <section className="panel us-connection-card"><div className="us-connection-icon"><Activity size={22}/></div><h3>Checking connected sources</h3><p>Checking the latest source health and freshness.</p></section> : error && !data ? <section className="panel us-connection-card"><div className="us-connection-icon"><Database size={22}/></div><h3>Source information is temporarily unavailable</h3><p>Configured source information could not be refreshed. Please retry in a moment.</p><button className="primary" onClick={reload}><RefreshCw size={15}/>Retry source status</button></section> : sources.length ? <section className="panel source-table"><div className="table-head"><span>SOURCE</span><span>PROVIDER</span><span>LAST UPDATE</span><span>STATUS</span><span/></div>{sources.map((source) => { const Icon = iconFor(source.source_type); return <div className="source-row" key={source.external_id}><div className="source-name"><span className="source-icon"><Icon size={16}/></span><span><b>{source.name}</b><small>{source.source_type} · {source.external_id}</small></span></div><span>{source.provider || '—'}</span><span>{humanAge(source.age_seconds)}</span><span className={`connected status-${source.status || 'unknown'}`}><i/>{source.status || 'unknown'}{source.freshness ? ` · ${source.freshness}` : ''}</span><button className="icon-btn" aria-label={`Refresh ${source.name}`} onClick={() => { reload(); notify('Checking the latest source status.'); }}><RefreshCw size={15}/></button></div>; })}</section> : <section className="panel"><EmptyState title="No configured data sources" description="Register an authorized provider, then refresh this list. The UI does not invent cameras, stations, or transit feed records."/></section>}
    {connectOpen && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConnectOpen(false); }}><form className="connect-modal" onSubmit={connectSource}><div className="modal-title"><div><div className="eyebrow">SOURCE REGISTRY</div><h3>Connect a source</h3></div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setConnectOpen(false)}><X size={16}/></button></div><label>External ID<input required minLength={2} maxLength={100} value={draft.external_id} onChange={(e) => setDraft({ ...draft, external_id: e.target.value })} placeholder="e.g. Delhi AQI network"/></label><label>Source name<input required minLength={2} maxLength={160} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Source display name"/></label><div className="modal-form-grid"><label>Source type<select value={draft.source_type} onChange={(e) => setDraft({ ...draft, source_type: e.target.value })}>{['camera','cpcb','openaq','gtfs','osm','atcs','sumo','transit','other'].map((type) => <option key={type} value={type}>{type === 'sumo' ? 'Road simulation' : type}</option>)}</select></label><div className="source-status-lock"><small>Initial health state</small><b>Not configured</b><span>Only a real provider sync or authenticated device heartbeat can mark this online.</span></div></div><label>Provider<input required minLength={1} maxLength={100} value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} placeholder="Provider or owner"/></label><label>Freshness target (seconds)<input type="number" min="0" max="604800" value={draft.freshness_seconds} onChange={(e) => setDraft({ ...draft, freshness_seconds: e.target.value })}/></label><p className="modal-disclaimer">This creates a registry record only. Configure credentials and an authorized feed separately; do not enter secrets here.</p><button className="primary full" type="submit" disabled={saving}><Database size={15}/>{saving ? 'Saving…' : 'Save source record'}</button></form></div>}
    {data?.warning && <p className="api-note">{data.warning}</p>}
  </>;
}
