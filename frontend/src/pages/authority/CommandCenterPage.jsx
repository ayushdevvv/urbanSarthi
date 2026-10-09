import { useMemo, useState } from 'react';
import { Activity, AirVent, AlertTriangle, Cloud, MapPin, Navigation, RefreshCw, Wind, X } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import { DEMO_COMMAND_OVERVIEW, DEMO_JUNCTIONS } from '../../data/demoData.js';

const display = (value, suffix = '') => value === null || value === undefined ? '—' : `${value}${suffix}`;
const minutes = (seconds) => seconds == null ? '—' : `${(seconds / 60).toFixed(1)} min`;
function Kpi({ icon: Icon, label, value, caption }) {
  return <div className="kpi"><div className="kpi-head"><Icon size={16}/><span>{label}</span></div><div className="compare single-value"><div><b>{value}</b><small>{caption || 'Latest API observation'}</small></div></div></div>;
}

export default function CommandCenterPage() {
  const { notify } = useApp();
  const { data, loading, error, reload } = useApiResource(() => api.get(endpoints.commandOverview), [], { fallback: DEMO_COMMAND_OVERVIEW });
  const { data: junctions } = useApiResource(() => api.get(endpoints.junctions), [], { fallback: DEMO_JUNCTIONS });
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(true);

  const hotSpots = data?.traffic?.junctions_high_congestion || [];
  const markers = useMemo(() => (junctions || []).filter((j) => Number.isFinite(j.latitude) && Number.isFinite(j.longitude)).map((j) => ({
    id: j.id, lat: j.latitude, lng: j.longitude, title: j.name,
    description: `Status: ${j.status || 'unknown'}`,
    kind: j.status === 'offline' ? 'critical' : 'normal',
  })), [junctions]);
  const picked = selected || hotSpots[0] || null;

  return <>
    <PageIntro eyebrow="INTEGRATED COMMAND & CONTROL CENTRE" title="Authority operations" description="Monitor traffic pressure, junction health, service notices and air-quality coverage. Scenario values never operate real traffic lights." action={<button className="live-pill" onClick={reload}><i/>{loading ? 'Refreshing…' : 'Refresh overview'} <RefreshCw size={13}/></button>} />
    <ErrorNotice message={error} onRetry={reload}/>
    <div className="kpi-grid">
      <Kpi icon={Activity} label="Congestion index" value={display(data?.traffic?.mean_congestion_score)} caption="Mean score from recent observations" />
      <Kpi icon={Navigation} label="Online junctions" value={display(data?.network?.junctions_online, ` / ${data?.network?.junctions_total ?? '—'}`)} caption="Reported junction status" />
      <Kpi icon={AirVent} label="Average AQI" value={display(data?.air_quality?.mean_aqi)} caption="Recent station observations" />
      <Kpi icon={Cloud} label="Active alerts" value={display(data?.alerts?.active_count)} caption="Alerts currently active" />
    </div>
    <div className="control-grid">
      <section className="panel map-panel"><div className="panel-head"><div><div className="eyebrow">CITY NETWORK MAP</div><h3>Congestion + AQI hotspots</h3></div><div className="legend"><span><i className="green-dot"/>Normal</span><span><i className="yellow-dot"/>Busy</span><span><i className="red-dot"/>Critical</span></div></div>
        <CityMap markers={markers} zoom={11} className="authority-map" />
        <div className="map-foot"><span><Navigation size={13}/> Traffic junctions</span><span><AirVent size={13}/> AQI observations</span><small>Configured junction coordinates are plotted; scenario coordinates may be approximate.</small></div>
      </section>
      <aside className="panel hotspot"><div className="hotspot-head"><span className={picked ? 'critical' : 'status-pill'}>{picked ? 'HIGH CONGESTION' : 'NETWORK OVERVIEW'}</span><button className="icon-btn" aria-label="Toggle selected hotspot" onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? <X size={16}/> : <MapPin size={16}/>}</button></div>
        {detailOpen && picked ? <><h3>{picked.name || `Junction ${picked.junction_id}`}</h3><p>Latest congestion observation</p><div className="hot-metrics"><div><small>Vehicles</small><b>{display(picked.vehicle_count)}</b></div><div><small>Queue length</small><b>{display(picked.queue_length_m, ' m')}</b></div><div><small>Congestion</small><b>{display(picked.congestion_score)}</b></div></div><div className="hotspot-detail-row"><span>Observed at</span><b>{picked.observed_at ? new Date(picked.observed_at).toLocaleString() : '—'}</b></div><button className="control-link" onClick={() => notify('Open the signal-plan what-if workspace. No physical traffic-light command is sent.')}>Signal control <b>Open signal plans <Navigation size={14}/></b></button></> : <EmptyState title="No recent traffic observations" description="The backend has not returned high-congestion observations for this city yet."/>}
        <div className="source-footnote"><AlertTriangle size={13}/> The API does not imply live CCTV or physical signal control is connected.</div>
      </aside>
    </div>
    <div className="below-grid"><section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">NETWORK STATUS</div><h3>Junction clusters</h3></div><span>{display(data?.network?.clusters_online, ` / ${data?.network?.clusters_total ?? '—'} online`)}</span></div><div className="compact-stat-row"><span>Junctions with recent traffic data</span><b>{display(data?.network?.junctions_with_recent_traffic_data)}</b></div><div className="compact-stat-row"><span>Junctions with forecasts</span><b>{display(data?.traffic?.forecasted_junction_count)}</b></div><div className="compact-stat-row"><span>Stations with recent AQI data</span><b>{display(data?.air_quality?.stations_with_recent_data)}</b></div></section>
      <section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">ACTIVE ALERTS</div><h3>Operational notices</h3></div><span>{display(data?.alerts?.active_count)} active</span></div>{(data?.alerts?.items || []).length ? data.alerts.items.slice(0, 4).map((alert) => <div className="alert-row" key={alert.id}><span className={`severity-dot severity-${String(alert.severity || '').toLowerCase()}`}/><div><b>{String(alert.title || '').replace(/^Demo\s*[·:-]\s*/i, 'Scenario · ').replace(/demo/gi, 'scenario').replace(/synthetic/gi, 'illustrative')}</b><small>{alert.category} · {alert.created_at ? new Date(alert.created_at).toLocaleString() : 'Time unavailable'}</small></div></div>) : <EmptyState title="No active alerts" description="The latest city overview has no active alerts. Network and junction status remain available."/>}</section></div>
  </>;
}
