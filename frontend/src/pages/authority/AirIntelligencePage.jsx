import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowRight, BarChart3, Bot, CheckCircle2,
  ChevronDown, CloudSun, Cpu, Gauge, Leaf, LoaderCircle, MapPin, RefreshCw,
  ShieldCheck, Signal, SlidersHorizontal, Sparkles, Wind, Zap,
} from 'lucide-react';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import { readLatestVisionEvidence } from '../../services/visionEvidence.js';
import './air-intelligence.css';

const CITIES = {
  Kanpur: { label: 'Kanpur, Uttar Pradesh', latitude: 26.4499, longitude: 80.3319 },
  Lucknow: { label: 'Lucknow, Uttar Pradesh', latitude: 26.8467, longitude: 80.9462 },
  Delhi: { label: 'Delhi, NCR', latitude: 28.6139, longitude: 77.2090 },
  Mumbai: { label: 'Mumbai, Maharashtra', latitude: 19.0760, longitude: 72.8777 },
};
const MOVEMENT_LABELS = {
  north_south_through: 'North / south through', east_west_through: 'East / west through',
  north_south_turn: 'North / south turn', east_west_turn: 'East / west turn',
};
const number = (value, digits = 1) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const timestamp = (value) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available';

function downloadJson(payload, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readVisionEvidence() {
  const value = readLatestVisionEvidence();
  return value?.counts && typeof value.counts === 'object' ? value : null;
}

function getAqiValue(current) {
  if (current?.us_aqi !== null && current?.us_aqi !== undefined) return { value: Number(current.us_aqi), scale: 'US AQI · 0–500' };
  if (current?.openweather_index !== null && current?.openweather_index !== undefined) return { value: Number(current.openweather_index), scale: 'OpenWeather · 1–5' };
  return { value: null, scale: 'AQI unavailable' };
}

function aqiBand(value, scale) {
  if (value === null || value === undefined) return 'awaiting data';
  if (scale.includes('1–5')) return ['good', 'fair', 'moderate', 'poor', 'very poor'][Math.max(0, Math.min(4, Math.round(value) - 1))];
  if (value <= 50) return 'good';
  if (value <= 100) return 'moderate';
  if (value <= 150) return 'sensitive groups';
  if (value <= 200) return 'unhealthy';
  if (value <= 300) return 'very unhealthy';
  return 'hazardous';
}

function AirGauge({ value, scale, band }) {
  const bounded = value === null ? 0 : scale.includes('1–5') ? value / 5 * 100 : value / 500 * 100;
  return <div className={`ai-gauge ai-band-${band.replaceAll(' ', '-')}`} style={{ '--ai-gauge-value': `${Math.max(0, Math.min(100, bounded)) * 3.6}deg` }}>
    <div className="ai-gauge-inner"><span>AMBIENT INDEX</span><b>{value === null ? '—' : number(value, 0)}</b><small>{band}</small></div>
  </div>;
}

function TrendChart({ forecast }) {
  const chart = useMemo(() => {
    const rows = (forecast || []).filter((row) => Number.isFinite(Number(row.pm25 ?? row.pm2_5)));
    if (rows.length < 2) return null;
    const values = rows.map((row) => Number(row.pm25 ?? row.pm2_5));
    const max = Math.max(10, ...values) * 1.15;
    const points = values.map((value, index) => ({
      x: 5 + index / (values.length - 1) * 90,
      y: 54 - value / max * 43,
      value,
      time: rowTime(rows[index]?.time),
    }));
    return { points, max, first: points[0], last: points[points.length - 1] };
  }, [forecast]);
  if (!chart) return <div className="ai-chart-empty"><Activity size={19}/><span>Hourly PM2.5 forecast will appear when provider data is available.</span></div>;
  const polyline = chart.points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `5,58 ${polyline} 95,58`;
  return <div className="ai-chart-shell">
    <div className="ai-chart-meta"><span><i className="ai-legend-dot"/> PM2.5 · µg/m³</span><span>{chart.first.value.toFixed(1)} → {chart.last.value.toFixed(1)}</span></div>
    <svg className="ai-trend-svg" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="Hourly PM2.5 forecast">
      {[14, 27, 40, 53].map((y) => <line key={y} x1="4" x2="96" y1={y} y2={y} className="ai-chart-gridline"/>)}
      <polygon points={area} className="ai-chart-area"/>
      <polyline points={polyline} className="ai-chart-line"/>
      {chart.points.filter((_, index) => index % Math.max(1, Math.floor(chart.points.length / 5)) === 0).map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="1.25" className="ai-chart-point"/>)}
    </svg>
    <div className="ai-chart-axis"><span>{chart.first.time}</span><span>Next 24 hours</span><span>{chart.last.time}</span></div>
  </div>;
}

function rowTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(11, 16) : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function PollutantTile({ label, value, unit, caption, max = 100 }) {
  const ratio = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, Number(value) / max * 100));
  return <div className="ai-pollutant-tile">
    <div><span>{label}</span><b>{number(value, 2)} <small>{unit}</small></b></div>
    <div className="ai-pollutant-track"><i style={{ width: `${ratio}%` }}/></div>
    <small>{caption}</small>
  </div>;
}

function EmissionBar({ label, value, max, unit = 'g' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Number(value || 0) / max * 100)) : 0;
  return <div className="ai-emission-bar-row"><div><span>{label}</span><b>{number(value, 2)} {unit}</b></div><div className="ai-emission-bar-track"><i style={{ width: `${pct}%` }}/></div></div>;
}

export default function AirIntelligencePage() {
  const { notify } = useApp();
  const [cityKey, setCityKey] = useState('Kanpur');
  const [air, setAir] = useState(null);
  const [airBusy, setAirBusy] = useState(false);
  const [airError, setAirError] = useState('');
  const [junctions, setJunctions] = useState([]);
  const [junctionId, setJunctionId] = useState('');
  const [corridorDistance, setCorridorDistance] = useState('0.5');
  const [hotspots, setHotspots] = useState(null);
  const [factors, setFactors] = useState(null);
  const [hotspotBusy, setHotspotBusy] = useState(false);
  const [hotspotError, setHotspotError] = useState('');
  const [vehicleCounts, setVehicleCounts] = useState({ car: '0', motorbike: '0', bus: '0', truck: '0', bicycle: '0' });
  const [visionEvidence, setVisionEvidence] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [cycleSeconds, setCycleSeconds] = useState('90');
  const [plan, setPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [message, setMessage] = useState('');

  const city = CITIES[cityKey] || CITIES.Kanpur;
  const refreshAir = useCallback(async () => {
    setAirBusy(true); setAirError('');
    try {
      const data = await api.get(`/aqi/location-forecast?latitude=${city.latitude}&longitude=${city.longitude}`);
      setAir(data);
    } catch (error) {
      setAirError(error.message || 'The ambient air-quality feed is unavailable.');
    } finally { setAirBusy(false); }
  }, [city.latitude, city.longitude]);

  const loadHotspots = useCallback(async () => {
    setHotspotBusy(true); setHotspotError('');
    try {
      const data = await api.get(`/air-intelligence/hotspots?corridor_distance_km=${encodeURIComponent(corridorDistance || '0.5')}`);
      setHotspots(data);
    } catch (error) { setHotspotError(error.message || 'Hotspots could not be loaded.'); }
    finally { setHotspotBusy(false); }
  }, [corridorDistance]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.get('/traffic/junctions'), api.get('/air-intelligence/factors')]).then(([junctionResult, factorResult]) => {
      if (!alive) return;
      if (junctionResult.status === 'fulfilled') {
        const rows = Array.isArray(junctionResult.value) ? junctionResult.value : [];
        setJunctions(rows);
        if (rows.length) setJunctionId(String(rows[0].id));
      }
      if (factorResult.status === 'fulfilled') setFactors(factorResult.value);
    });
    const evidence = readVisionEvidence();
    if (evidence) setVisionEvidence(evidence);
    return () => { alive = false; };
  }, []);

  useEffect(() => { refreshAir(); }, [refreshAir]);
  useEffect(() => { loadHotspots(); }, [loadHotspots]);

  const current = air?.current || {};
  const ambientIndex = getAqiValue(current);
  const band = aqiBand(ambientIndex.value, ambientIndex.scale);
  const hotspotItems = hotspots?.items || [];
  const topHotspot = hotspotItems[0];
  const emissionComparison = comparison?.result?.emissions_comparison;
  const trafficComparison = comparison?.result?.traffic_comparison;
  const pollutants = [
    ['PM2.5', current.pm25 ?? current.pm2_5, 'µg/m³', 'Fine particulate matter', 150],
    ['PM10', current.pm10, 'µg/m³', 'Coarse particulate matter', 250],
    ['NO₂', current.nitrogen_dioxide, 'µg/m³', 'Nitrogen dioxide', 200],
    ['O₃', current.ozone, 'µg/m³', 'Ground-level ozone', 200],
  ];
  const maxEmission = Math.max(1, ...['co2_g', 'nox_g', 'pm_g', 'co_g'].map((key) => Number(estimate?.totals?.[key] || 0)));

  async function calculateEmissions() {
    setEstimateBusy(true); setMessage('');
    try {
      const data = await api.post('/air-intelligence/emissions/estimate', {
        vehicle_counts: Object.fromEntries(Object.entries(vehicleCounts).map(([key, value]) => [key, Number(value) || 0])),
        segment_distance_km: Number(corridorDistance),
      });
      setEstimate(data);
      notify('Traffic-related tailpipe emissions estimate calculated.');
    } catch (error) { setMessage(error.message || 'Emission estimate failed.'); }
    finally { setEstimateBusy(false); }
  }

  function importVisionCounts() {
    const evidence = readVisionEvidence();
    if (!evidence) { setMessage('Run a YOLO analysis in Traffic Lab first.'); return; }
    setVisionEvidence(evidence);
    setVehicleCounts({
      car: String(evidence.counts.car || 0), motorbike: String(evidence.counts.motorbike || 0),
      bus: String(evidence.counts.bus || 0), truck: String(evidence.counts.truck || 0),
      bicycle: String(evidence.counts.bicycle || 0),
    });
    setMessage('Latest YOLO vehicle mix imported. Set corridor distance, then calculate.');
  }

  async function generatePlan() {
    if (!junctionId) { setMessage('Register or select a junction first.'); return; }
    setPlanBusy(true); setMessage(''); setComparison(null);
    try {
      const data = await api.post('/air-intelligence/signal-plans/optimize', {
        junction_id: Number(junctionId), cycle_seconds: Number(cycleSeconds),
      });
      setPlan(data.plan);
      notify(data.plan?.projected_outcomes?.optimized ? 'Emissions-aware draft created for review.' : 'Equal-split draft created; camera calibration is incomplete.');
    } catch (error) { setMessage(error.message || 'Signal plan could not be generated.'); }
    finally { setPlanBusy(false); }
  }

  async function comparePlan() {
    if (!plan?.id) return;
    setCompareBusy(true); setMessage('');
    try {
      const data = await api.post('/air-intelligence/simulations/compare', {
        junction_id: Number(junctionId), signal_plan_id: plan.id,
        scenario: 'baseline', name: 'Baseline vs intervention',
      });
      setComparison(data);
      notify('Baseline and intervention comparison completed.');
    } catch (error) { setMessage(error.message || 'SUMO comparison could not run. Check that native SUMO is installed and configured.'); }
    finally { setCompareBusy(false); }
  }

  async function downloadImpactReport() {
    if (!comparison?.simulation_id) return;
    try {
      const report = await api.get(`/air-intelligence/reports/${comparison.simulation_id}`);
      downloadJson(report, `air-impact-report-${comparison.simulation_id}.json`);
    } catch (error) { setMessage(error.message || 'Report could not be downloaded.'); }
  }

  const ambientSourceNote = air?.note || 'Modelled location forecast; it is not a ground-station measurement.';
  const freshness = air?.updated_at || air?.forecast?.[0]?.time;

  return <main className="air-intel-page">
    <section className="ai-hero">
      <div className="ai-hero-copy">
        <div className="ai-hero-overline"><span className="ai-pulse-dot"/> INNOVATEX 2026–27 <i/> THEME 02 · RISING URBAN AQI</div>
        <h1>Air quality <em>intelligence.</em></h1>
        <p>From street-level traffic evidence to air-quality intelligence. Detect pollution pressure, estimate vehicle emissions and test targeted interventions before an operator signs off.</p>
        <div className="ai-hero-tags"><span><Cpu size={13}/> YOLO + OpenCV</span><span><Wind size={13}/> AQI forecasting</span><span><Bot size={13}/> AI decision support</span></div>
      </div>
      <div className="ai-hero-visual" aria-hidden="true"><div className="ai-orbit ai-orbit-one"/><div className="ai-orbit ai-orbit-two"/><div className="ai-globe"><Wind size={43}/><span/></div><i className="ai-orbit-node node-one"/><i className="ai-orbit-node node-two"/><i className="ai-orbit-node node-three"/></div>
    </section>

    <div className="ai-live-toolbar">
      <div className="ai-location-control"><MapPin size={16}/><div><span>MONITORING AREA</span><select value={cityKey} onChange={(event) => setCityKey(event.target.value)}>{Object.entries(CITIES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></div></div>
      <div className="ai-live-meta"><span className={`ai-feed-indicator ${air?.status === 'available' ? 'active' : ''}`}/><span>{air?.provider || 'Ambient forecast feed'}</span><i/> <span>Updated {timestamp(freshness)}</span></div>
      <button className="ai-refresh-button" onClick={refreshAir} disabled={airBusy}>{airBusy ? <LoaderCircle size={14} className="ai-spin"/> : <RefreshCw size={14}/>} Refresh air data</button>
    </div>

    {airError && <div className="ai-inline-error"><AlertTriangle size={15}/>{airError}</div>}
    <section className="ai-ambient-grid">
      <article className="ai-ambient-card ai-aqi-card">
        <div className="ai-card-eyebrow"><span>AMBIENT AIR QUALITY</span><span className="ai-source-badge"><CloudSun size={12}/> {air?.aqi_scale || 'Location outlook'}</span></div>
        <div className="ai-aqi-content"><AirGauge value={ambientIndex.value} scale={ambientIndex.scale} band={band}/><div className="ai-aqi-copy"><h2>{band === 'awaiting data' ? 'Air data unavailable' : `Air quality · ${band}`}</h2><p>{city.label}. Current ambient outlook from {air?.provider || 'the configured provider'}.</p><div className="ai-aqi-foot"><span><MapPin size={13}/>{Number(city.latitude).toFixed(3)}, {Number(city.longitude).toFixed(3)}</span><span><Activity size={13}/>{ambientIndex.scale}</span></div></div></div>
        <small className="ai-provenance-note">{ambientSourceNote}</small>
      </article>
      <article className="ai-ambient-card ai-pollutant-card">
        <div className="ai-panel-head"><div><span className="ai-kicker">POLLUTANT PROFILE</span><h3>What is in the air?</h3></div><span className="ai-source-pill">CURRENT OUTLOOK</span></div>
        <div className="ai-pollutant-grid">{pollutants.map(([label, value, unit, caption, max]) => <PollutantTile key={label} label={label} value={value} unit={unit} caption={caption} max={max}/>)}</div>
        <div className="ai-pollutant-foot"><span>PM2.5 + PM10 show particulate levels; gases remain separate indicators.</span><b>{air?.status === 'available' ? 'FEED AVAILABLE' : air?.status === 'unavailable' ? 'FEED OFFLINE' : 'PARTIAL FEED'}</b></div>
      </article>
    </section>

    <section className="ai-section-grid ai-first-grid">
      <article className="ai-panel ai-trend-panel">
        <div className="ai-panel-head"><div><span className="ai-kicker">NEXT 24 HOURS</span><h3>Particulate outlook</h3><p>Modelled hourly PM2.5 trend for the selected monitoring area.</p></div><span className="ai-source-pill"><Activity size={12}/> FORECAST</span></div>
        <TrendChart forecast={air?.forecast}/>
      </article>
      <article className="ai-panel ai-system-panel">
        <div className="ai-panel-head"><div><span className="ai-kicker">AIR QUALITY RESPONSE LOOP</span><h3>From road activity to cleaner air</h3></div><span className="ai-source-pill">END-TO-END</span></div>
        <div className="ai-pipeline">
          {[
            [Cpu, 'Detect', 'YOLO + OpenCV', 'Vehicle mix'],
            [BarChart3, 'Quantify', 'Emission factors', 'CO₂ · NOx · PM · CO'],
            [MapPin, 'Prioritise', 'Hotspot engine', 'Junction ranking'],
            [Zap, 'Intervene', 'Signal optimisation', 'Human-approved plan'],
          ].map(([Icon, title, name, detail], index) => <div className="ai-pipeline-step" key={title}><span className="ai-pipeline-icon"><Icon size={17}/></span><div><b>{title}</b><small>{name}</small><em>{detail}</em></div>{index < 3 && <ArrowRight size={14} className="ai-pipeline-arrow"/>}</div>)}
        </div>
        <div className="ai-safety-strip"><ShieldCheck size={15}/><span>Model output stays advisory. Operator review is required; no physical controller is connected.</span></div>
      </article>
    </section>

    <section className="ai-kpis">
      <article className="ai-kpi"><span><FlameIcon/> Ranked pollution hotspots</span><b>{hotspots ? hotspotItems.length : '—'}</b><small>Recent junction observations</small></article>
      <article className="ai-kpi"><span><Activity size={15}/> Highest relative score</span><b>{number(topHotspot?.hotspot_score, 1)}</b><small>{topHotspot?.junction_name || 'Waiting for traffic evidence'}</small></article>
      <article className="ai-kpi"><span><Signal size={15}/> Junctions with AQI context</span><b>{hotspotItems.filter((item) => item.ambient_air_quality).length}</b><small>Nearby recent station observations</small></article>
      <article className="ai-kpi"><span><Leaf size={15}/> Estimated CO₂</span><b>{estimate ? `${number(estimate.totals?.co2_g, 1)} g` : '—'}</b><small>{estimate ? `${number(estimate.vehicle_km, 2)} vehicle-km modelled` : 'Run the corridor estimator below'}</small></article>
    </section>

    <section className="ai-section-grid ai-emissions-grid">
      <article className="ai-panel ai-hotspot-panel">
        <div className="ai-panel-head"><div><span className="ai-kicker">01 / POLLUTION HOTSPOTS</span><h3>Which junction needs attention?</h3><p>Ranked from recent traffic observations, indicative tailpipe emissions and nearby AQI.</p></div><button className="ai-icon-refresh" onClick={loadHotspots} disabled={hotspotBusy} aria-label="Refresh hotspots">{hotspotBusy ? <LoaderCircle size={15} className="ai-spin"/> : <RefreshCw size={15}/>}</button></div>
        <div className="ai-distance-control"><label>Assumed monitored corridor length</label><div><input type="number" min="0.001" max="100" step="0.1" value={corridorDistance} onChange={(event) => setCorridorDistance(event.target.value)}/><span>km</span></div></div>
        {hotspotError && <div className="ai-inline-error"><AlertTriangle size={15}/>{hotspotError}</div>}
        {hotspotBusy && !hotspots ? <div className="ai-empty"><LoaderCircle className="ai-spin"/>Loading latest junction evidence…</div> : hotspotItems.length ? <div className="ai-hotspot-list">
          {hotspotItems.slice(0, 7).map((item) => <button key={item.junction_id} className={`ai-hotspot-row ${String(item.junction_id) === String(junctionId) ? 'selected' : ''}`} onClick={() => setJunctionId(String(item.junction_id))}>
            <span className="ai-rank">{String(item.rank).padStart(2, '0')}</span>
            <span className="ai-hotspot-main"><b>{item.junction_name}</b><small>{item.traffic?.vehicle_count ?? 0} vehicles · {(item.data_quality || 'not available').replaceAll('_', ' ')}</small><i style={{ '--ai-hotspot-width': `${Math.max(3, Number(item.hotspot_score || 0))}%` }}/></span>
            <span className="ai-hotspot-components"><small>Traffic {number(item.traffic?.congestion_score, 0)}</small><small>AQI {number(item.ambient_air_quality?.aqi, 0)}</small></span>
            <strong>{number(item.hotspot_score, 1)}</strong>
          </button>)}
        </div> : <div className="ai-empty"><CloudSun size={22}/><b>No recent hotspot evidence</b><p>Analyze a road clip in Traffic Lab or ingest junction observations. The ranking will populate from saved evidence.</p></div>}
        <p className="ai-footnote">{hotspots?.note || 'Hotspot scores are relative to the returned junction set and are not regulatory AQI values.'}</p>
      </article>

      <article className="ai-panel ai-estimator-panel">
        <div className="ai-panel-head"><div><span className="ai-kicker">02 / TRAFFIC-TO-EMISSIONS</span><h3>Carbon & pollutant estimator</h3><p>Translate a detected vehicle mix into estimated tailpipe emissions.</p></div><span className="ai-source-pill">{factors?.factor_version || 'BS-VI PROXY'}</span></div>
        <div className="ai-vision-import"><div><span className="ai-vision-mark"><Cpu size={16}/></span><span><b>{visionEvidence?.source_filename || 'YOLO evidence not imported'}</b><small>{visionEvidence ? `Latest video analysis · ${visionEvidence.sampled_frames || 1} sampled frames` : 'Run a video in Traffic Lab to import detected vehicle counts.'}</small></span></div><button onClick={importVisionCounts}><RefreshCw size={13}/> Import</button></div>
        <div className="ai-count-grid">
          {[['car', 'Cars'], ['motorbike', 'Two-wheelers'], ['bus', 'Buses'], ['truck', 'Trucks'], ['bicycle', 'Bicycles']].map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="1000000" value={vehicleCounts[key]} onChange={(event) => setVehicleCounts((old) => ({ ...old, [key]: event.target.value }))}/></label>)}
        </div>
        <div className="ai-estimator-actions"><span>Distance assumption <b>{corridorDistance || '0.5'} km</b></span><button className="ai-primary-button" onClick={calculateEmissions} disabled={estimateBusy}>{estimateBusy ? <><LoaderCircle size={15} className="ai-spin"/> Calculating…</> : <><Activity size={15}/> Calculate emissions</>}</button></div>
        {estimate && <div className="ai-estimate-result">
          <div className="ai-carbon-total"><div><span>ESTIMATED CARBON FOOTPRINT</span><b>{number(estimate.totals?.co2_g, 1)} <small>g CO₂</small></b><em>{number(estimate.vehicle_km, 2)} vehicle-km in {estimate.segment_distance_km} km corridor</em></div><div className="ai-carbon-orbit"><Leaf size={23}/></div></div>
          <div className="ai-emission-bars">
            <EmissionBar label="CO₂" value={estimate.totals?.co2_g} max={maxEmission}/>
            <EmissionBar label="NOx" value={estimate.totals?.nox_g} max={maxEmission}/>
            <EmissionBar label="PM" value={estimate.totals?.pm_g} max={maxEmission}/>
            <EmissionBar label="CO" value={estimate.totals?.co_g} max={maxEmission}/>
          </div>
          <div className="ai-pollutant-grid ai-estimate-pollutants"><div><span>NOx</span><b>{number(estimate.totals?.nox_g, 3)} g</b></div><div><span>PM</span><b>{number(estimate.totals?.pm_g, 3)} g</b></div><div><span>CO</span><b>{number(estimate.totals?.co_g, 2)} g</b></div><div><span>CO₂</span><b>{number(estimate.totals?.co2_g, 1)} g</b></div></div>
          {estimate.by_class && <div className="ai-class-breakdown"><span className="ai-kicker">EMISSIONS BY VEHICLE CLASS</span>{Object.entries(estimate.by_class).filter(([, value]) => value.vehicle_km > 0).map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><b>{number(value.co2_g, 1)} g CO₂</b><small>{number(value.vehicle_km, 2)} veh-km</small></div>)}</div>}
          <button className="ai-text-button" onClick={() => downloadJson(estimate, 'emissions-estimate.json')}><ArrowDownToLine size={14}/> Download calculation & assumptions</button>
        </div>}
        <p className="ai-footnote">Indicative factors only. Fuel-use values are project assumptions, not measured fleet rates. Tailpipe emissions are not ambient AQI and exclude road dust, brake/tyre wear and atmospheric chemistry.</p>
      </article>
    </section>

    <section className="ai-panel ai-optimization-panel">
      <div className="ai-panel-head"><div><span className="ai-kicker">03 / EMISSIONS-AWARE TRAFFIC INTERVENTION</span><h3>Optimise signal timing before deployment</h3><p>Build a candidate plan from camera-calibrated approach demand, then compare the baseline with the intervention.</p></div><span className="ai-review-pill"><ShieldCheck size={13}/> HUMAN REVIEW REQUIRED</span></div>
      <div className="ai-optimization-controls">
        <label><span>Target junction</span><select value={junctionId} onChange={(event) => { setJunctionId(event.target.value); setPlan(null); setComparison(null); }}><option value="">Select junction</option>{junctions.map((item) => <option key={item.id} value={item.id}>{item.name} · #{item.id}</option>)}</select></label>
        <label><span>Signal cycle</span><select value={cycleSeconds} onChange={(event) => setCycleSeconds(event.target.value)}>{[60, 75, 90, 105, 120, 135, 150].map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>
        <button className="ai-primary-button" onClick={generatePlan} disabled={!junctionId || planBusy}>{planBusy ? <><LoaderCircle size={15} className="ai-spin"/> Optimising…</> : <><SlidersHorizontal size={15}/> Generate candidate plan</>}</button>
      </div>
      <p className="ai-footnote">Directional optimisation needs all four manually calibrated camera regions: <code>north_south_through</code>, <code>east_west_through</code>, <code>north_south_turn</code>, <code>east_west_turn</code>. Without them, the system deliberately creates an equal-split draft and labels it as uncalibrated.</p>
      {plan && <div className="ai-plan-result">
        <div className="ai-plan-head"><div><span className="ai-kicker">CANDIDATE PLAN #{plan.id}</span><h4>{plan.cycle_seconds}s adaptive cycle</h4></div><span className={`ai-status-pill ${plan.projected_outcomes?.optimized ? 'optimized' : 'fallback'}`}>{plan.projected_outcomes?.optimized ? 'EMISSIONS-AWARE DRAFT' : 'EQUAL-SPLIT FALLBACK'}</span></div>
        <p>{plan.rationale}</p>
        <div className="ai-phase-bars">{plan.phases?.map((phase) => <div key={phase.movement || phase.name}><div><b>{MOVEMENT_LABELS[phase.movement] || phase.name}</b><span>{phase.green_seconds}s green</span></div><div className="ai-phase-track"><i style={{ width: `${Math.min(100, phase.green_seconds / Math.max(1, plan.cycle_seconds) * 100)}%` }}/></div><small>{phase.yellow_seconds}s yellow · {phase.all_red_seconds}s all-red</small></div>)}</div>
        <div className="ai-plan-actions"><span><ShieldCheck size={15}/> Draft saved. Review and approve it in Signal Plans.</span><button className="ai-primary-button" onClick={comparePlan} disabled={compareBusy}>{compareBusy ? <><LoaderCircle size={15} className="ai-spin"/> Running SUMO…</> : <><Activity size={15}/> Compare baseline vs intervention</>}</button></div>
      </div>}
      {message && <div className="ai-inline-error"><AlertTriangle size={15}/>{message}</div>}
    </section>

    {comparison && <section className="ai-panel ai-comparison-panel">
      <div className="ai-panel-head"><div><span className="ai-kicker">04 / ENVIRONMENTAL IMPACT</span><h3>Baseline versus intervention</h3><p>Same generated demand, with the candidate signal timing applied in the SUMO experiment.</p></div><span className="ai-native-pill"><CheckCircle2 size={13}/> {comparison.engine}</span></div>
      <div className="ai-comparison-grid"><div><span>Average waiting time</span><b>{number(trafficComparison?.average_wait_seconds?.baseline, 1)}s <em>→</em> {number(trafficComparison?.average_wait_seconds?.proposed, 1)}s</b><small>{number(trafficComparison?.average_wait_seconds?.change_percent, 1)}% change</small></div><div><span>Queue at 60 min</span><b>{number(trafficComparison?.queue_at_60m?.baseline, 0)} <em>→</em> {number(trafficComparison?.queue_at_60m?.proposed, 0)}</b><small>{number(trafficComparison?.queue_at_60m?.change_percent, 1)}% change</small></div><div><span>Vehicles completed</span><b>{number(trafficComparison?.vehicles_completed?.baseline, 0)} <em>→</em> {number(trafficComparison?.vehicles_completed?.proposed, 0)}</b><small>{number(trafficComparison?.vehicles_completed?.change_percent, 1)}% change</small></div></div>
      <div className="ai-emissions-comparison"><div className="ai-emissions-comparison-head"><div><span className="ai-kicker">ESTIMATED TAILPIPE EMISSIONS</span><h4>{emissionComparison?.available ? 'Pollution change after intervention' : 'Emissions comparison unavailable'}</h4></div><Leaf size={21}/></div>
        {emissionComparison?.available ? <div className="ai-impact-grid">{[['CO₂', 'co2_g'], ['NOx', 'nox_g'], ['PM', 'pm_g'], ['CO', 'co_g']].map(([label, key]) => { const delta = Number(emissionComparison.change_percent?.[key] ?? 0); return <div key={key}><span>{label}</span><b>{number(emissionComparison.proposed?.totals?.[key], 2)} g</b><strong className={delta <= 0 ? 'is-down' : 'is-up'}>{delta > 0 ? '+' : ''}{number(delta, 2)}%</strong><small>{delta <= 0 ? 'estimated reduction' : 'estimated increase'}</small></div>; })}</div> : <p className="ai-footnote">SUMO completed but trip-distance records were unavailable, so no emissions delta is shown.</p>}
      </div>
      <div className="ai-report-actions"><p>{comparison.caveats?.[0] || 'SUMO uses the bundled synthetic road network. This is not a mapped city-junction field result.'}</p><button className="ai-secondary-button" onClick={downloadImpactReport}><ArrowDownToLine size={15}/> Download environmental report</button></div>
    </section>}

    <section className="ai-source-panel"><div><span className="ai-kicker">MODEL TRANSPARENCY</span><h3>What the numbers mean</h3><p>{factors?.method_note || 'Ambient AQI, forecast pollutants and estimated tailpipe emissions are separate data products. Each keeps its own scale, source and limitations.'}</p></div><div className="ai-source-links"><a href={factors?.factor_source?.url} target="_blank" rel="noreferrer">{factors?.factor_source?.title || 'Indian BS-VI source-apportionment factors'}</a><a href={factors?.co2_method_source?.url} target="_blank" rel="noreferrer">{factors?.co2_method_source?.title || 'Fuel carbon-factor method'}</a></div></section>
  </main>;
}

function FlameIcon() { return <span className="ai-flame-symbol">✦</span>; }
