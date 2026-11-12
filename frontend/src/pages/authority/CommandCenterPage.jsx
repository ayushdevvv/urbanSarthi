import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AirVent, AlertTriangle, Cloud, MapPin, Navigation, RefreshCw } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState } from '../../components/shared/Toast.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';

const display = (value, suffix = '') => value === null || value === undefined ? '—' : `${value}${suffix}`;
function Kpi({ icon: Icon, label, value, caption }) {
  return <div className="kpi"><div className="kpi-head"><Icon size={16}/><span>{label}</span></div><div className="compare single-value"><div><b>{value}</b><small>{caption || 'Latest API observation'}</small></div></div></div>;
}

export default function CommandCenterPage() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApiResource(() => api.get(endpoints.commandOverview), []);
  const { data: junctions } = useApiResource(() => api.get(endpoints.junctions), []);
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(true);

  const overview = data || null;
  const hotSpots = overview?.traffic?.junctions_high_congestion || [];
  const markers = useMemo(() => (junctions || []).filter((j) => Number.isFinite(Number(j.latitude)) && Number.isFinite(Number(j.longitude))).map((j) => ({
    id: j.id, lat: j.latitude, lng: j.longitude, title: j.name,
    description: `Status: ${j.status || 'unknown'}`,
    kind: j.status === 'offline' ? 'critical' : 'normal',
  })), [junctions]);
  const mapMarkers = markers;
  const picked = selected || hotSpots[0] || null;

  return <>
    <PageIntro eyebrow="INTEGRATED COMMAND & CONTROL CENTRE" title="Authority operations" description="Your integrated command centre for traffic, air quality, junctions and citywide mobility." action={<button className="live-pill" onClick={reload}><i/>{loading ? 'Refreshing…' : 'Refresh overview'} <RefreshCw size={13}/></button>} />
    {!overview ? <section className="panel us-connection-card" aria-live="polite">
      <div className="us-connection-icon"><Activity size={22}/></div>
      <h3>{loading ? 'Connecting to city services' : 'City overview is temporarily unavailable'}</h3>
      <p>{loading ? 'Loading the latest junction, traffic and air-quality information.' : 'The live API did not return an operational snapshot. No demo or synthetic values are substituted here. Retry or connect verified data sources.'}</p>
      <button className="primary" onClick={reload} disabled={loading}><RefreshCw size={15}/>{loading ? 'Checking live services…' : 'Retry live data'}</button>
    </section> : <>
      <div className="notice scenario-notice"><Activity size={14}/>Backend snapshot · only registered infrastructure and ingested observations</div>
      <div className="kpi-grid">
        <Kpi icon={Activity} label="Congestion index" value={display(overview?.traffic?.mean_congestion_score)} caption={overview?.traffic?.junctions_with_recent_traffic_data ? 'Mean score from recent observations' : 'Awaiting live traffic telemetry'} />
        <Kpi icon={Navigation} label="Online junctions" value={display(overview?.network?.junctions_online, ` / ${overview?.network?.junctions_total ?? '—'}`)} caption='Reported status of registered junctions' />
        <Kpi icon={AirVent} label="Average AQI" value={display(overview?.air_quality?.mean_aqi)} caption={overview?.air_quality?.stations_with_recent_data ? 'Recent station observations' : 'Awaiting live station readings'} />
        <Kpi icon={Cloud} label="Active alerts" value={display(overview?.alerts?.active_count)} caption='Active backend alerts' />
      </div>
      <div className="control-grid">
        <section className="panel map-panel"><div className="panel-head"><div><div className="eyebrow">CITY MAP</div><h3>Congestion + AQI hotspots</h3></div><div className="legend"><span><i className="green-dot"/>Normal</span><span><i className="yellow-dot"/>Busy</span><span><i className="red-dot"/>Critical</span></div></div>
          <CityMap markers={mapMarkers} zoom={11} className="authority-map" />
          <div className="map-foot"><span><Navigation size={13}/> Traffic junctions</span><span><AirVent size={13}/> AQI observations</span><small>{markers.length ? `${markers.length} registered junctions mapped` : 'No real junction coordinates registered yet.'}</small></div>
        </section>
        <aside className="panel hotspot"><div className="hotspot-head"><span className={picked ? 'critical' : 'status-pill'}>{picked ? 'HIGH CONGESTION' : 'NO HOTSPOT DATA'}</span><button className="icon-btn" aria-label="Toggle selected hotspot" onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? '×' : <MapPin size={16}/>}</button></div>
          {detailOpen && picked ? <><h3>{picked.name || `Junction ${picked.junction_id}`}</h3><p>Latest ingested congestion observation</p><div className="hot-metrics"><div><small>Vehicles</small><b>{display(picked.vehicle_count)}</b></div><div><small>Queue length</small><b>{display(picked.queue_length_m, ' m')}</b></div><div><small>Congestion</small><b>{display(picked.congestion_score)}</b></div></div><div className="hotspot-detail-row"><span>Observed at</span><b>{picked.observed_at ? new Date(picked.observed_at).toLocaleString() : '—'}</b></div><button className="control-link" onClick={() => navigate('/authority/traffic-agent')}>Signal strategy <b>Open Traffic Agent <Navigation size={14}/></b></button></> : <EmptyState title="No recent traffic observations" description="The selected city has no highlighted hotspot in the current view."/>}
          <div className="source-footnote"><AlertTriangle size={13}/> The API does not imply live CCTV or physical signal control is connected.</div>
        </aside>
      </div>
      <div className="below-grid"><section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">NETWORK STATUS</div><h3>Junction clusters</h3></div><span>{display(overview?.network?.clusters_online, ` / ${display(overview?.network?.clusters_total ?? '—')} online`)}</span></div><div className="compact-stat-row"><span>Junctions with recent traffic data</span><b>{display(overview?.network?.junctions_with_recent_traffic_data)}</b></div><div className="compact-stat-row"><span>Junctions with forecasts</span><b>{display(overview?.traffic?.forecasted_junction_count)}</b></div><div className="compact-stat-row"><span>Stations with recent AQI data</span><b>{display(overview?.air_quality?.stations_with_recent_data)}</b></div></section>
        <section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">ACTIVE ALERTS</div><h3>Operational notices</h3></div><span>{display(overview?.alerts?.active_count)} active</span></div>{(overview?.alerts?.items || []).length ? overview.alerts.items.slice(0, 4).map((alert) => <div className="alert-row" key={alert.id}><span className={`severity-dot severity-${String(alert.severity || '').toLowerCase()}`}/><div><b>{alert.title}</b><small>{alert.category} · {alert.created_at ? new Date(alert.created_at).toLocaleString() : 'Time unavailable'}</small></div></div>) : <EmptyState title="No active alerts" description="No active notices in this view."/>}</section></div>
    </>}
  </>;
}
