import { useMemo, useState } from 'react';
import { Activity, AirVent, AlertTriangle, Cloud, MapPin, Navigation, RefreshCw, Wind, X } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const display = (value, suffix = '') => value === null || value === undefined ? '—' : `${value}${suffix}`;
const minutes = (seconds) => seconds == null ? '—' : `${(seconds / 60).toFixed(1)} min`;
function Kpi({ icon: Icon, label, value, caption }) {
  return <div className="kpi"><div className="kpi-head"><Icon size={16}/><span>{label}</span></div><div className="compare single-value"><div><b>{value}</b><small>{caption || 'Latest API observation'}</small></div></div></div>;
}

export default function CommandCenterPage() {
  const { notify } = useApp();
  const { data, loading, error, reload } = useApiResource(() => api.get(endpoints.commandOverview), []);
  const { data: junctions } = useApiResource(() => api.get(endpoints.junctions), []);
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(true);

  const demo = {
    traffic: { mean_congestion_score: 64, forecasted_junction_count: 42, junctions_high_congestion: [
      { id: 'demo-hotspot-1', junction_id: 12, name: 'Ring Road and Central Avenue', vehicle_count: 186, queue_length_m: 142, congestion_score: 82, observed_at: new Date().toISOString() },
      { id: 'demo-hotspot-2', junction_id: 8, name: 'Metro Gate Junction', vehicle_count: 124, queue_length_m: 86, congestion_score: 68, observed_at: new Date().toISOString() },
    ] },
    network: { junctions_online: 42, junctions_total: 48, clusters_online: 8, clusters_total: 9, junctions_with_recent_traffic_data: 39 },
    air_quality: { mean_aqi: 126, stations_with_recent_data: 12 },
    alerts: { active_count: 3, items: [
      { id: 'demo-alert-1', severity: 'high', title: 'Heavy congestion near Central Avenue', category: 'Traffic', created_at: new Date().toISOString() },
      { id: 'demo-alert-2', severity: 'medium', title: 'Air quality trending upward in the north zone', category: 'Air quality', created_at: new Date().toISOString() },
      { id: 'demo-alert-3', severity: 'low', title: 'Signal coordination review suggested', category: 'Signals', created_at: new Date().toISOString() },
    ] },
  };
  const overview = data || demo;
  const displayData = overview;
  const hotSpots = overview?.traffic?.junctions_high_congestion || [];
  const markers = useMemo(() => (junctions || []).filter((j) => Number.isFinite(j.latitude) && Number.isFinite(j.longitude)).map((j) => ({
    id: j.id, lat: j.latitude, lng: j.longitude, title: j.name,
    description: `Status: ${j.status || 'unknown'}`,
    kind: j.status === 'offline' ? 'critical' : 'normal',
  })), [junctions]);
  const picked = selected || hotSpots[0] || null;

  return <>
    <PageIntro eyebrow="INTEGRATED COMMAND & CONTROL CENTRE" title="Authority operations" description="Your integrated command centre for traffic, air quality, junctions and citywide mobility." action={<button className="live-pill" onClick={reload}><i/>{loading ? 'Refreshing…' : 'Refresh overview'} <RefreshCw size={13}/></button>} />
    <div className="notice scenario-notice"><Activity size={14}/>{data ? 'City operations overview' : 'City operations overview · Scenario view'}</div>
    <div className="kpi-grid">
      <Kpi icon={Activity} label="Congestion index" value={display(displayData?.traffic?.mean_congestion_score)} caption="Mean score from recent observations" />
      <Kpi icon={Navigation} label="Online junctions" value={display(displayData?.network?.junctions_online, ` / ${displayData?.network?.junctions_total ?? '—'}`)} caption="Reported junction status" />
      <Kpi icon={AirVent} label="Average AQI" value={display(displayData?.air_quality?.mean_aqi)} caption="Recent station observations" />
      <Kpi icon={Cloud} label="Active alerts" value={display(displayData?.alerts?.active_count)} caption="Alerts currently active" />
    </div>
    <div className="control-grid">
      <section className="panel map-panel"><div className="panel-head"><div><div className="eyebrow">LIVE CITY MAP</div><h3>Congestion + AQI hotspots</h3></div><div className="legend"><span><i className="green-dot"/>Normal</span><span><i className="yellow-dot"/>Busy</span><span><i className="red-dot"/>Critical</span></div></div>
        <CityMap markers={markers.length ? markers : [{ id: 'demo-map-1', lat: 28.6139, lng: 77.2090, title: 'Central Avenue', description: 'Scenario congestion hotspot', kind: 'critical' }, { id: 'demo-map-2', lat: 28.6280, lng: 77.2180, title: 'Metro Gate', description: 'Scenario traffic junction', kind: 'busy' }]} zoom={11} className="authority-map" />
        <div className="map-foot"><span><Navigation size={13}/> Traffic junctions</span><span><AirVent size={13}/> AQI observations</span><small>Configured junction coordinates are plotted; seeded demo coordinates may be placeholders.</small></div>
      </section>
      <aside className="panel hotspot"><div className="hotspot-head"><span className={picked ? 'critical' : 'status-pill'}>{picked ? 'HIGH CONGESTION' : 'NO HOTSPOT DATA'}</span><button className="icon-btn" aria-label="Toggle selected hotspot" onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? <X size={16}/> : <MapPin size={16}/>}</button></div>
        {detailOpen && picked ? <><h3>{picked.name || `Junction ${picked.junction_id}`}</h3><p>Latest congestion observation</p><div className="hot-metrics"><div><small>Vehicles</small><b>{display(picked.vehicle_count)}</b></div><div><small>Queue length</small><b>{display(picked.queue_length_m, ' m')}</b></div><div><small>Congestion</small><b>{display(picked.congestion_score)}</b></div></div><div className="hotspot-detail-row"><span>Observed at</span><b>{picked.observed_at ? new Date(picked.observed_at).toLocaleString() : '—'}</b></div><button className="control-link" onClick={() => notify('Signal timing changes require a reviewed plan and an authorized operator account.')}>Signal control <b>Open signal plans <Navigation size={14}/></b></button></> : <EmptyState title="No recent traffic observations" description="The selected city has no highlighted hotspot in the current view."/>}
        <div className="source-footnote"><AlertTriangle size={13}/> The API does not imply live CCTV or physical signal control is connected.</div>
      </aside>
    </div>
    <div className="below-grid"><section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">NETWORK STATUS</div><h3>Junction clusters</h3></div><span>{display(displayData?.network?.clusters_online, ` / ${displayData?.network?.clusters_total ?? '—'} online`)}</span></div><div className="compact-stat-row"><span>Junctions with recent traffic data</span><b>{display(displayData?.network?.junctions_with_recent_traffic_data)}</b></div><div className="compact-stat-row"><span>Junctions with forecasts</span><b>{display(displayData?.traffic?.forecasted_junction_count)}</b></div><div className="compact-stat-row"><span>Stations with recent AQI data</span><b>{display(displayData?.air_quality?.stations_with_recent_data)}</b></div></section>
      <section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">ACTIVE ALERTS</div><h3>Operational notices</h3></div><span>{display(displayData?.alerts?.active_count)} active</span></div>{(displayData?.alerts?.items || []).length ? displayData.alerts.items.slice(0, 4).map((alert) => <div className="alert-row" key={alert.id}><span className={`severity-dot severity-${String(alert.severity || '').toLowerCase()}`}/><div><b>{alert.title}</b><small>{alert.category} · {alert.created_at ? new Date(alert.created_at).toLocaleString() : 'Time unavailable'}</small></div></div>) : <EmptyState title="No active alerts" description="No active notices in this view."/>}</section></div>
  </>;
}
