import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AirVent, AlertTriangle, BarChart3, Camera, Cloud, Leaf, MapPin, Navigation, RadioTower, RefreshCw, Route, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState } from '../../components/shared/Toast.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { api, endpoints } from '../../services/api/client.js';
import { readApiSnapshot } from '../../services/apiSnapshot.js';

const display = (value, suffix = '') => value === null || value === undefined ? '—' : `${value}${suffix}`;
function Kpi({ icon: Icon, label, value, caption }) {
  return <div className="kpi"><div className="kpi-head"><Icon size={17}/><span>{label}</span></div><div className="compare single-value"><div><b>{value}</b><small>{caption || 'Latest API observation'}</small></div></div></div>;
}
const EMPTY_OVERVIEW = { traffic: {}, network: {}, air_quality: {}, alerts: { items: [], active_count: null } };

export default function CommandCenterPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(() => readApiSnapshot(endpoints.commandOverview)?.payload || null);
  const [junctions, setJunctions] = useState(() => readApiSnapshot(endpoints.junctions)?.payload || []);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(true);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError('');
    const results = await Promise.allSettled([
      api.get(endpoints.commandOverview, { timeoutMs: 8000, fallbackGraceMs: 0 }),
      api.get(endpoints.junctions, { timeoutMs: 8000, fallbackGraceMs: 0 }),
    ]);
    if (results[0].status === 'fulfilled') setData(results[0].value);
    if (results[1].status === 'fulfilled') setJunctions(Array.isArray(results[1].value) ? results[1].value : []);
    if (results.every((result) => result.status === 'rejected')) setError('Live command data is unavailable. The overview stays usable and will not invent city readings.');
    else if (results.some((result) => result.status === 'rejected')) setError('Some live sources did not respond. Available reports are shown; missing metrics remain blank.');
    setRefreshing(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const overview = data || EMPTY_OVERVIEW;
  const hotSpots = overview?.traffic?.junctions_high_congestion || [];
  const markers = useMemo(() => {
    const congestion = new Map((overview?.traffic?.junctions_high_congestion || []).map((item) => [Number(item.junction_id), item]));
    const junctionMarkers = (junctions || []).filter((j) => Number.isFinite(Number(j.latitude)) && Number.isFinite(Number(j.longitude))).map((j) => {
      const reading = congestion.get(Number(j.id));
      return { id: `junction-${j.id}`, lat: j.latitude, lng: j.longitude, title: j.name,
        description: reading ? `High congestion · ${reading.congestion_score ?? '—'} score · ${reading.vehicle_count ?? '—'} vehicles` : `Status: ${j.status || 'unknown'}`,
        kind: reading ? 'critical' : j.status === 'offline' ? 'critical' : 'normal' };
    });
    const aqiMarkers = (overview?.air_quality?.stations || []).filter((station) => Number.isFinite(Number(station.latitude)) && Number.isFinite(Number(station.longitude))).map((station) => ({
      id: `aqi-${station.id}`, lat: station.latitude, lng: station.longitude, title: station.station_name,
      description: `AQI ${station.aqi ?? 'not reported'} · ${station.category || station.source} · ${new Date(station.observed_at).toLocaleString()}`,
      kind: 'aqi',
    }));
    const alertMarkers = (overview?.alerts?.items || []).filter((alert) => Number.isFinite(Number(alert.latitude)) && Number.isFinite(Number(alert.longitude))).map((alert) => ({
      id: `alert-${alert.id}`, lat: alert.latitude, lng: alert.longitude, title: alert.title,
      description: `${alert.severity} ${alert.category} alert`, kind: 'critical',
    }));
    return [...junctionMarkers, ...aqiMarkers, ...alertMarkers];
  }, [junctions, overview]);
  const picked = selected || hotSpots[0] || null;

  return <>
    <PageIntro eyebrow="INTEGRATED COMMAND & CONTROL CENTRE" title="City overview" description="Traffic, air quality, infrastructure and city operations in one view." action={<button className="live-pill" onClick={reload} disabled={refreshing}><i/>{refreshing ? 'Refreshing' : 'Refresh reports'} <RefreshCw size={13}/></button>} />
    {error && <div className="notice scenario-notice" role="status"><AlertTriangle size={14}/>{error}</div>}
    <div className="notice scenario-notice"><Activity size={14}/>Verified observations only · {data?.generated_at ? `report generated ${new Date(data.generated_at).toLocaleTimeString()}` : 'waiting for connected sources'}</div>
    <div className="kpi-grid">
      <Kpi icon={Activity} label="Congestion index" value={display(overview?.traffic?.mean_congestion_score)} caption={overview?.traffic?.junctions_with_recent_traffic_data ? 'Mean from recent observations' : 'Awaiting traffic telemetry'} />
      <Kpi icon={Navigation} label="Online junctions" value={display(overview?.network?.junctions_online, ` / ${overview?.network?.junctions_total ?? '—'}`)} caption="Registered field infrastructure" />
      <Kpi icon={AirVent} label="Average AQI" value={display(overview?.air_quality?.mean_aqi)} caption={overview?.air_quality?.stations_with_recent_data ? 'Recent station readings' : 'Awaiting station data'} />
      <Kpi icon={Cloud} label="Active alerts" value={display(overview?.alerts?.active_count)} caption="Operational notices" />
    </div>
    <div className="control-grid">
      <section className="panel map-panel"><div className="panel-head"><div><div className="eyebrow">CITY MAP</div><h3>Live infrastructure map</h3></div><div className="legend"><span><i className="green-dot"/>Junction</span><span><i className="red-dot"/>Alert / hotspot</span><span><i className="aqi-dot"/>AQI station</span></div></div>
        <CityMap city={data?.city?.name || data?.city_name || "Lucknow"} markers={markers} zoom={11} className="authority-map" />
        <div className="map-foot"><span><Navigation size={13}/> Junctions · <AirVent size={13}/> AQI · <AlertTriangle size={13}/> Alerts</span><small>{markers.length ? `${markers.length} verified locations` : 'No junction, station or alert coordinates registered yet.'}</small></div>
      </section>
      <aside className="panel hotspot"><div className="hotspot-head"><span className={picked ? 'critical' : 'status-pill'}>{picked ? 'REPORTED HOTSPOT' : 'NO RECENT HOTSPOTS'}</span><button className="icon-btn" aria-label="Toggle selected hotspot" onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? '×' : <MapPin size={16}/>}</button></div>
        {detailOpen && picked ? <><h3>{picked.name || `Junction ${picked.junction_id}`}</h3><p>Latest ingested traffic observation</p><div className="hot-metrics"><div><small>Vehicles</small><b>{display(picked.vehicle_count)}</b></div><div><small>Queue length</small><b>{display(picked.queue_length_m, ' m')}</b></div><div><small>Congestion</small><b>{display(picked.congestion_score)}</b></div></div><div className="hotspot-detail-row"><span>Observed at</span><b>{picked.observed_at ? new Date(picked.observed_at).toLocaleString() : '—'}</b></div><button className="control-link" onClick={() => navigate('/authority/traffic-agent')}>Signal strategy <b>Open Traffic Agent <Navigation size={14}/></b></button></> : <EmptyState title="No live hotspot data" description="Connect camera or junction observations to surface verified congestion hotspots."/>}
        <div className="source-footnote"><AlertTriangle size={13}/> No physical traffic-light controller is assumed connected.</div>
      </aside>
    </div>
    <div className="below-grid"><section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">NETWORK STATUS</div><h3>Infrastructure report</h3></div><span>{display(overview?.network?.clusters_online, ` / ${display(overview?.network?.clusters_total ?? '—')} clusters`)}</span></div><div className="compact-stat-row"><span>Junctions with recent traffic data</span><b>{display(overview?.network?.junctions_with_recent_traffic_data)}</b></div><div className="compact-stat-row"><span>Junctions with forecasts</span><b>{display(overview?.traffic?.forecasted_junction_count)}</b></div><div className="compact-stat-row"><span>Stations with recent AQI data</span><b>{display(overview?.air_quality?.stations_with_recent_data)}</b></div><div className="compact-stat-row"><span>Configured data sources</span><b>{display(overview?.data_sources?.configured_sources)}</b></div></section>
      <section className="panel compact-list"><div className="panel-head"><div><div className="eyebrow">ACTIVE ALERTS</div><h3>Operational notices</h3></div><span>{display(overview?.alerts?.active_count)} active</span></div>{(overview?.alerts?.items || []).length ? overview.alerts.items.slice(0, 4).map((alert) => <div className="alert-row" key={alert.id}><span className={`severity-dot severity-${String(alert.severity || '').toLowerCase()}`}/><div><b>{alert.title}</b><small>{alert.category} · {alert.created_at ? new Date(alert.created_at).toLocaleString() : 'Time unavailable'}</small></div></div>) : <EmptyState title="No active alerts" description="There are no current authority alerts."/>}</section></div>
    <section className="panel sumo-quick-links"><div className="sumo-panel-head"><div><span>OPERATIONS</span><h2>Open a workbench</h2></div></div><div className="sumo-quick-grid">
      <button onClick={() => navigate('/authority/traffic-lab')}><Camera size={18}/><span><b>Traffic Lab</b><small>Vehicle detection and camera evidence</small></span><Navigation size={14}/></button>
      <button onClick={() => navigate('/authority/traffic-simulation')}><Route size={18}/><span><b>Traffic simulation</b><small>Road-network signal experiments</small></span><Navigation size={14}/></button>
      <button onClick={() => navigate('/authority/traffic-agent')}><Activity size={18}/><span><b>Traffic Agent</b><small>Evidence and signal-plan workflow</small></span><Navigation size={14}/></button>
      <button onClick={() => navigate('/authority/air-intelligence')}><Wind size={18}/><span><b>AQI intelligence</b><small>Station readings and forecasts</small></span><Navigation size={14}/></button>
      <button onClick={() => navigate('/authority/carbon')}><Leaf size={18}/><span><b>Carbon emissions</b><small>Estimated transport emissions</small></span><Navigation size={14}/></button>
      <button onClick={() => navigate('/authority/iot')}><RadioTower size={18}/><span><b>IoT sensors</b><small>Device telemetry and health</small></span><Navigation size={14}/></button>
      <button onClick={() => navigate('/authority/analytics')}><BarChart3 size={18}/><span><b>City reports</b><small>Historical trends and analytics</small></span><Navigation size={14}/></button>
    </div></section>
  </>;
}
