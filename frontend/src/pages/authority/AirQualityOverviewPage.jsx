import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CloudSun, Droplets, MapPin, RefreshCw, RadioTower, Wind, Waves, Leaf, Camera, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api/client.js';
import PageIntro from '../../components/shared/PageIntro.jsx';
import './monitoring-pages.css';

const AREAS = {
  Lucknow: { label: 'Lucknow, Uttar Pradesh', lat: 26.8467, lon: 80.9462 },
  Kanpur: { label: 'Kanpur, Uttar Pradesh', lat: 26.4499, lon: 80.3319 },
  Delhi: { label: 'Delhi, NCR', lat: 28.6139, lon: 77.2090 },
  Mumbai: { label: 'Mumbai, Maharashtra', lat: 19.0760, lon: 72.8777 },
};
const fmt = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const age = (value) => {
  if (!value) return 'Time unavailable';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : `${Math.floor(seconds / 3600)} hr ago`;
};
function indexValue(current = {}) {
  if (current.us_aqi != null) return { value: Number(current.us_aqi), max: 500, scale: 'US AQI', unit: '/ 500' };
  if (current.openweather_index != null) return { value: Number(current.openweather_index), max: 5, scale: 'OpenWeather index', unit: '/ 5' };
  return { value: null, max: 500, scale: 'AQI unavailable', unit: '' };
}
function bandFor(value, max) {
  if (value == null) return { label: 'Awaiting readings', tone: 'neutral' };
  if (max === 5) return value <= 1 ? { label: 'Good', tone: 'good' } : value <= 2 ? { label: 'Fair', tone: 'good' } : value <= 3 ? { label: 'Moderate', tone: 'moderate' } : value <= 4 ? { label: 'Poor', tone: 'poor' } : { label: 'Very poor', tone: 'critical' };
  return value <= 50 ? { label: 'Good', tone: 'good' } : value <= 100 ? { label: 'Moderate', tone: 'moderate' } : value <= 150 ? { label: 'Sensitive groups', tone: 'moderate' } : value <= 200 ? { label: 'Unhealthy', tone: 'poor' } : value <= 300 ? { label: 'Very unhealthy', tone: 'critical' } : { label: 'Hazardous', tone: 'critical' };
}
function AqiDial({ value, max, tone }) {
  const progress = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const radius = 77;
  const circumference = 2 * Math.PI * radius;
  return <div className={`aqi-dial tone-${tone}`}>
    <svg viewBox="0 0 190 190" role="img" aria-label={`Air quality index ${value ?? 'unavailable'}`}>
      <circle cx="95" cy="95" r={radius} className="aqi-dial-track" />
      <circle cx="95" cy="95" r={radius} className="aqi-dial-progress" strokeDasharray={`${circumference * progress} ${circumference}`} transform="rotate(-90 95 95)" />
      <circle cx="95" cy="95" r="59" className="aqi-dial-inner" />
    </svg>
    <div className="aqi-dial-copy"><small>LIVE AQI</small><strong>{value == null ? '—' : Math.round(value)}</strong><span>{value == null ? 'No reading' : 'Current index'}</span></div>
  </div>;
}
function AirTrend({ rows, max }) {
  const points = useMemo(() => {
    const valid = (rows || []).filter((row) => Number.isFinite(Number(row.pm25 ?? row.pm2_5)));
    if (valid.length < 2) return [];
    const vals = valid.map((row) => Number(row.pm25 ?? row.pm2_5));
    const upper = Math.max(10, ...vals) * 1.12;
    return valid.map((row, index) => ({ x: 8 + index / (valid.length - 1) * 484, y: 126 - (Number(row.pm25 ?? row.pm2_5) / upper) * 98, value: Number(row.pm25 ?? row.pm2_5), time: row.time }));
  }, [rows]);
  if (points.length < 2) return <div className="monitor-empty-chart"><Activity size={20}/><span>Hourly particulate trend appears when forecast data is available.</span></div>;
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');
  return <div className="air-trend-chart">
    <div className="chart-legend"><span><i/> PM2.5 · µg/m³</span><small>24-hour outlook</small></div>
    <svg viewBox="0 0 500 150" preserveAspectRatio="none" aria-label="PM2.5 forecast trend">
      {[28, 58, 88, 118].map((y) => <line key={y} x1="5" x2="495" y1={y} y2={y} className="monitor-gridline"/>)}
      <polygon points={`8,136 ${line} 492,136`} className="monitor-chart-fill"/>
      <polyline points={line} className="monitor-chart-line"/>
      {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 5)) === 0).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" className="monitor-chart-point"/>)}
    </svg>
    <div className="chart-time-axis"><span>{new Date(points[0].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>Now</span><span>{new Date(points.at(-1).time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
  </div>;
}
function Pollutant({ name, value, unit, limit, note }) {
  const pct = value == null ? 0 : Math.min(100, Math.max(3, Number(value) / limit * 100));
  return <article className="pollutant-card"><div className="pollutant-top"><span>{name}</span><b>{fmt(value, 1)} <small>{unit}</small></b></div><div className="pollutant-track"><i style={{ width: `${pct}%` }}/></div><small>{note}</small></article>;
}

export default function AirQualityOverviewPage() {
  const [areaKey, setAreaKey] = useState('Lucknow');
  const [report, setReport] = useState(null);
  const [nearby, setNearby] = useState(null);
  const [hotspots, setHotspots] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const area = AREAS[areaKey];
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    const [airResult, stationResult, hotspotResult] = await Promise.allSettled([
      api.get(`/aqi/location-forecast?latitude=${area.lat}&longitude=${area.lon}`),
      api.get(`/aqi/nearby?latitude=${area.lat}&longitude=${area.lon}&radius_km=15`),
      api.get('/air-intelligence/hotspots?corridor_distance_km=0.5'),
    ]);
    if (airResult.status === 'fulfilled') setReport(airResult.value); else setError(airResult.reason?.message || 'Air quality feed is unavailable.');
    if (stationResult.status === 'fulfilled') setNearby(stationResult.value); else setNearby(null);
    if (hotspotResult.status === 'fulfilled') setHotspots(hotspotResult.value); else setHotspots(null);
    setLoading(false);
  }, [area.lat, area.lon]);
  useEffect(() => { refresh(); }, [refresh]);

  const current = report?.current || {};
  const index = indexValue(current);
  const band = bandFor(index.value, index.max);
  const forecast = report?.forecast || [];
  const stationRows = nearby?.stations || [];
  const hotspotRows = hotspots?.items || [];
  const updated = report?.updated_at || report?.forecast?.[0]?.time;
  const pollutants = [
    ['PM2.5', current.pm25 ?? current.pm2_5, 'µg/m³', 60, 'Fine particles'],
    ['PM10', current.pm10, 'µg/m³', 100, 'Coarse particles'],
    ['NO₂', current.nitrogen_dioxide, 'µg/m³', 80, 'Nitrogen dioxide'],
    ['O₃', current.ozone, 'µg/m³', 100, 'Ground-level ozone'],
  ];
  const sensorAverage = useMemo(() => {
    const values = stationRows.map((row) => row.station?.aqi).filter((n) => n != null && Number.isFinite(Number(n))).map(Number);
    return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
  }, [stationRows]);

  return <main className="monitor-page air-overview-page">
    <PageIntro eyebrow="AIR QUALITY" title="Air quality overview" description="A city-wide view of ambient air, pollutant levels and the places that need attention." action={<><label className="area-select-wrap"><MapPin size={15}/><select value={areaKey} onChange={(event) => setAreaKey(event.target.value)}>{Object.entries(AREAS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><button className="monitor-button" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'monitor-spin' : ''}/>{loading ? 'Updating' : 'Refresh'}</button></>} />
    {error && <div className="monitor-alert"><AlertTriangle size={15}/>{error}</div>}

    <section className="aqi-command-hero">
      <div className="aqi-hero-orbit orbit-a"/><div className="aqi-hero-orbit orbit-b"/><div className="aqi-hero-orbit orbit-c"/>
      <div className="aqi-hero-main">
        <div className="aqi-hero-copy"><div className="monitor-overline"><span className="status-pulse"/> CITY AIR STATUS <i/> {area.label.toUpperCase()}</div>
          <h2>Understand the air.<br/><em>Act before it worsens.</em></h2>
          <p>Track the current air-quality outlook, identify rising pollutants and focus attention on affected corridors.</p>
          <div className="aqi-hero-meta"><span><CloudSun size={14}/>{report?.provider || 'Waiting for air-quality feed'}</span><span><Activity size={14}/>{updated ? `Updated ${age(updated)}` : 'No recent update'}</span></div>
        </div>
        <div className="aqi-hero-index"><AqiDial value={index.value} max={index.max} tone={band.tone}/><div className={`aqi-status-label status-${band.tone}`}>{band.label}</div><small>{index.scale} · {index.unit || '—'}</small></div>
      </div>
      <div className="aqi-hero-bottom"><span><MapPin size={13}/>{area.label}</span><span>{report?.note || 'Provider model outlook. Ground-station observations are displayed separately below.'}</span></div>
    </section>

    <section className="monitor-kpis">
      <article className="monitor-kpi"><div className="kpi-icon green"><Wind size={17}/></div><span>PM2.5 concentration</span><strong>{fmt(current.pm25 ?? current.pm2_5)} <small>µg/m³</small></strong><em>Fine particulate matter</em></article>
      <article className="monitor-kpi"><div className="kpi-icon blue"><Waves size={17}/></div><span>Nearby sensor stations</span><strong>{stationRows.length}</strong><em>{nearby?.status === 'available' ? 'Recent station observations' : 'No recent station observations'}</em></article>
      <article className="monitor-kpi"><div className="kpi-icon amber"><MapPin size={17}/></div><span>Priority hotspots</span><strong>{hotspotRows.length}</strong><em>Ranked from available traffic and air evidence</em></article>
      <article className="monitor-kpi"><div className="kpi-icon mint"><Leaf size={17}/></div><span>Station AQI average</span><strong>{fmt(sensorAverage, 0)}</strong><em>Measured stations only · separate from forecast</em></article>
    </section>

    <section className="monitor-grid monitor-grid-primary">
      <article className="monitor-panel pollutant-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">POLLUTANT PROFILE</span><h3>What is in the air?</h3><p>Each pollutant is shown in its own concentration unit.</p></div><span className="monitor-live-badge"><i/> {report?.status === 'available' ? 'Feed available' : report?.status || 'Awaiting feed'}</span></div><div className="pollutant-grid">{pollutants.map(([name, value, unit, limit, note]) => <Pollutant key={name} name={name} value={value} unit={unit} limit={limit} note={note}/>)}</div><div className="pollutant-footnote">Concentration indicators are not interchangeable with the overall AQI index.</div></article>
      <article className="monitor-panel trend-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">NEXT 24 HOURS</span><h3>Fine particle outlook</h3><p>Hourly PM2.5 forecast for the selected area.</p></div><Activity size={18}/></div><AirTrend rows={forecast} max={60}/><div className="trend-footer"><span>Forecast points <b>{forecast.length}</b></span><span>Source <b>{report?.provider || 'Unavailable'}</b></span></div></article>
    </section>

    <section className="monitor-grid monitor-grid-lower">
      <article className="monitor-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">FIELD OBSERVATIONS</span><h3>Nearby sensor network</h3><p>Ground observations received by the platform within 15 km.</p></div><Link to="/authority/iot" className="monitor-text-link">Manage sensors <ChevronRight size={14}/></Link></div>
        {stationRows.length ? <div className="station-list">{stationRows.slice(0, 5).map((row) => { const station = row.station || {}; return <div className="station-row" key={station.id}><div className="station-marker"><RadioTower size={15}/></div><div className="station-info"><b>{station.station_name || 'Air sensor'}</b><small>{station.source || 'Sensor feed'} · {row.distance_meters != null ? `${(row.distance_meters / 1000).toFixed(1)} km away` : 'Distance unavailable'}</small></div><div className="station-measure"><b>{fmt(station.aqi, 0)}</b><small>AQI</small></div><span className="station-age">{age(station.observed_at)}</span></div>; })}</div> : <div className="monitor-empty"><RadioTower size={22}/><b>No recent sensor readings in this area</b><span>Connect an air-quality sensor or send a test observation to see it here.</span><Link to="/authority/iot">Open IoT network <ChevronRight size={14}/></Link></div>}
      </article>
      <article className="monitor-panel hotspot-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">POLLUTION PRESSURE</span><h3>Priority locations</h3><p>Relative ranking from available traffic and air-quality evidence.</p></div><Link to="/authority/traffic" className="monitor-text-link">Traffic view <ChevronRight size={14}/></Link></div>
        {hotspotRows.length ? <div className="hotspot-list">{hotspotRows.slice(0, 4).map((item, index) => <div className="hotspot-row" key={item.junction_id || item.junction_name}><span className="hotspot-rank">0{index + 1}</span><div className="hotspot-details"><b>{item.junction_name}</b><small>{item.ambient_air_quality?.category || 'Ambient station data unavailable'} · {item.data_quality?.replaceAll('_', ' ') || 'Partial evidence'}</small><div className="hotspot-meter"><i style={{ width: `${Math.max(4, Number(item.hotspot_score || 0))}%` }}/></div></div><strong>{fmt(item.hotspot_score, 0)}</strong></div>)}</div> : <div className="monitor-empty compact"><MapPin size={20}/><b>No ranked locations yet</b><span>Hotspots appear after traffic observations are recorded.</span></div>}
        <small className="monitor-caveat">Scores are relative to the returned shortlist, not a regulatory pollution-risk scale.</small>
      </article>
    </section>

    <section className="monitor-journeys"><Link to="/authority/carbon" className="monitor-journey-card"><span className="journey-icon"><Leaf size={18}/></span><div><b>Carbon & emissions</b><small>Estimate CO₂, NOx, PM and CO from observed traffic.</small></div><ChevronRight size={16}/></Link><Link to="/authority/traffic-lab" className="monitor-journey-card"><span className="journey-icon"><Camera size={18}/></span><div><b>Traffic intelligence</b><small>Analyze road footage and create an evidence report.</small></div><ChevronRight size={16}/></Link></section>
  </main>;
}
