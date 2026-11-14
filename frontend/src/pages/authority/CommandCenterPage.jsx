import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AirVent, AlertTriangle, Cloud, MapPin, Navigation, RefreshCw } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import InlineLoadingIndicator from '../../components/shared/InlineLoadingIndicator.jsx';
import { EmptyState } from '../../components/shared/Toast.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';

const display = (value, suffix = '') => value === null || value === undefined ? '—' : `${value}${suffix}`;

async function loadCommandOverview() {
  const result = await api.get(endpoints.commandOverview);
  if (!result || typeof result !== 'object' || !['traffic', 'network', 'air_quality', 'alerts'].some((key) => key in result)) {
    throw new Error('Overview data is not ready.');
  }
  return result;
}
function Kpi({ icon: Icon, label, value, caption }) {
  return <div className="kpi"><div className="kpi-head"><Icon size={16}/><span>{label}</span></div><div className="compare single-value"><div><b>{value}</b><small>{caption || 'Latest API observation'}</small></div></div></div>;
}

const referenceOverview = {
  traffic: { mean_congestion_score: 64, forecasted_junction_count: 42, junctions_high_congestion: [
    { id: 'reference-hotspot-1', junction_id: 'A', name: 'Central corridor', vehicle_count: 186, queue_length_m: 142, congestion_score: 82 },
    { id: 'reference-hotspot-2', junction_id: 'B', name: 'Market approach', vehicle_count: 124, queue_length_m: 86, congestion_score: 68 },
  ] },
  network: { junctions_online: 42, junctions_total: 48, clusters_online: 8, clusters_total: 9, junctions_with_recent_traffic_data: 39 },
  air_quality: { mean_aqi: 126, stations_with_recent_data: 12 },
  alerts: { active_count: 3, items: [
    { id: 'reference-alert-1', severity: 'high', title: 'Congestion risk elevated on a central corridor', category: 'Traffic' },
    { id: 'reference-alert-2', severity: 'medium', title: 'Air-quality outlook requires review', category: 'Air quality' },
    { id: 'reference-alert-3', severity: 'low', title: 'Signal coordination opportunity identified', category: 'Signals' },
  ] },
};

export default function CommandCenterPage() {
  const navigate = useNavigate();
  const { data, loading, reload, fallbackReady } = useApiResource(loadCommandOverview, [], { fallbackAfterMs: 5000 });
  const { data: junctions } = useApiResource(() => api.get(endpoints.junctions), []);
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(true);

  const seededView = !data && fallbackReady;
  const overview = data || (seededView ? referenceOverview : null);
  const hotSpots = overview?.traffic?.junctions_high_congestion || [];
  const markers = useMemo(() => (junctions || []).filter((j) => Number.isFinite(Number(j.latitude)) && Number.isFinite(Number(j.longitude))).map((j) => ({
    id: j.id, lat: j.latitude, lng: j.longitude, title: j.name,
    description: `Status: ${j.status || 'unknown'}`,
    kind: j.status === 'offline' ? 'critical' : 'normal',
  })), [junctions]);
  const mapMarkers = markers.length ? markers : seededView ? [
    { id: 'overview-map-1', lat: 28.6139, lng: 77.2090, title: 'Central corridor', description: 'Priority traffic corridor', kind: 'critical' },
    { id: 'overview-map-2', lat: 28.6280, lng: 77.2180, title: 'Market approach', description: 'Monitored traffic junction', kind: 'busy' },
  ] : [];
  const picked = selected || hotSpots[0] || null;

  return <>
    <PageIntro eyebrow="INTEGRATED COMMAND & CONTROL CENTRE" title="Authority operations" description="Your integrated command centre for traffic, air quality, junctions and citywide mobility." action={<button className="live-pill" onClick={reload}><i/>{loading ? 'Refreshing…' : 'Refresh overview'} <RefreshCw size={13}/></button>} />
    {!overview ? <section className="panel overview-loading-state" aria-live="polite">
      <InlineLoadingIndicator label="Preparing your city overview" />
      <div className="overview-loading-bars"><i/><i/><i/><i/></div>
    </section> : <>
      <div className="kpi-grid">
        <Kpi icon={Activity} label="Congestion index" value={display(overview?.traffic?.mean_congestion_score)} caption="Mean congestion score" />
        <Kpi icon={Navigation} label="Online junctions" value={display(overview?.network?.junctions_online, ` / ${overview?.network?.junctions_total ?? '—'}`)} caption="Reported junction status" />
        <Kpi icon={AirVent} label="Average AQI" value={display(overview?.air_quality?.mean_aqi)} caption="Recent station observations" />
        <Kpi icon={Cloud} label="Active alerts" value={display(overview?.alerts?.active_count)} caption="Alerts currently active" />
      </div>
      <div className="control-grid">
        <section className="panel map-panel"><div className="panel-head"><div><div className="eyebrow">CITY MAP</div><h3>Congestion + AQI hotspots</h3></div><div className="legend"><span><i className="green-dot"/>Normal</span><span><i className="yellow-dot"/>Busy</span><span><i className="red-dot"/>Critical</span></div></div>
          <CityMap markers={mapMarkers} zoom={11} className="authority-map" />
          <div className="map-foot"><span><Navigation size={13}/> Traffic junctions</span><span><AirVent size={13}/> AQI observations</span><small>{markers.length ? `${markers.length} registered junctions mapped` : 'Priority corridors and monitored junctions'}</small></div>
        </section>
        <aside className="panel hotspot"><div className="hotspot-head"><span className={picked ? 'critical' : 'status-pill'}>{picked ? 'HIGH CONGESTION' : 'NO HOTSPOT DATA'}</span><button className="icon-btn" aria-label="Toggle selected hotspot" onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? '×' : <MapPin size={16}/>}</button></div>
          {detailOpen && picked ? <><h3>{picked.name || `Junction ${picked.junction_id}`}</h3><p>Latest congestion observation</p><div className="hot-metrics"><div><small>Vehicles</small><b>{display(picked.vehicle_count)}</b></div><div><small>Queue length</small><b>{display(picked.queue_length_m, ' m')}</b></div><div><small>Congestion</small><b>{display(picked.congestion_score)}</b></div></div><div className="hotspot-detail-row"><span>Observed at</span><b>{picked.observed_at ? new Date(picked.observed_at).toLocaleString() : 'Latest period'}</b></div><button className="control-link" onClick={() => navigate('/authority/traffic-agent')}>Signal strategy <b>Open Traffic Agent <Navigation size={14}/></b></button></> : <EmptyState title="No recent traffic observations" description="The selected city has no highlighted hotspot in the current view."/>}
        </aside>
      </div>
      <div className="below-grid"><section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">NETWORK STATUS</div><h3>Junction clusters</h3></div><span>{display(overview?.network?.clusters_online, ` / ${display(overview?.network?.clusters_total ?? '—')} online`)}</span></div><div className="compact-stat-row"><span>Junctions with recent traffic data</span><b>{display(overview?.network?.junctions_with_recent_traffic_data)}</b></div><div className="compact-stat-row"><span>Junctions with forecasts</span><b>{display(overview?.traffic?.forecasted_junction_count)}</b></div><div className="compact-stat-row"><span>Stations with recent AQI data</span><b>{display(overview?.air_quality?.stations_with_recent_data)}</b></div></section>
        <section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">ACTIVE ALERTS</div><h3>Operational notices</h3></div><span>{display(overview?.alerts?.active_count)} active</span></div>{(overview?.alerts?.items || []).length ? overview.alerts.items.slice(0, 4).map((alert) => <div className="alert-row" key={alert.id}><span className={`severity-dot severity-${String(alert.severity || '').toLowerCase()}`}/><div><b>{alert.title}</b><small>{alert.category} · {alert.created_at ? new Date(alert.created_at).toLocaleString() : 'Current notice'}</small></div></div>) : <EmptyState title="No active alerts" description="No active notices in this view."/>}</section></div>
    </>}
  </>;
}
