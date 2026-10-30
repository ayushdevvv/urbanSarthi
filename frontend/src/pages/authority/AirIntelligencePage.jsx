import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, CheckCircle2, CloudSun, Flame,
  Leaf, LoaderCircle, RefreshCw, ShieldCheck, Signal, SlidersHorizontal,
} from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import './air-intelligence.css';

const MOVEMENT_LABELS = {
  north_south_through: 'North / south through',
  east_west_through: 'East / west through',
  north_south_turn: 'North / south turn',
  east_west_turn: 'East / west turn',
};

const number = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });

function downloadJson(payload, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AirIntelligencePage() {
  const { notify } = useApp();
  const [junctions, setJunctions] = useState([]);
  const [junctionId, setJunctionId] = useState('');
  const [corridorDistance, setCorridorDistance] = useState('0.5');
  const [hotspots, setHotspots] = useState(null);
  const [factors, setFactors] = useState(null);
  const [hotspotBusy, setHotspotBusy] = useState(false);
  const [hotspotError, setHotspotError] = useState('');

  const [vehicleCounts, setVehicleCounts] = useState({ car: '0', motorbike: '0', bus: '0', truck: '0', bicycle: '0' });
  const [estimate, setEstimate] = useState(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [cycleSeconds, setCycleSeconds] = useState('90');
  const [plan, setPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [message, setMessage] = useState('');

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
    return () => { alive = false; };
  }, []);

  const loadHotspots = useCallback(async () => {
    setHotspotBusy(true);
    setHotspotError('');
    try {
      const data = await api.get(`/air-intelligence/hotspots?corridor_distance_km=${encodeURIComponent(corridorDistance || '0.5')}`);
      setHotspots(data);
    } catch (error) {
      setHotspotError(error.message || 'Hotspots could not be loaded.');
    } finally { setHotspotBusy(false); }
  }, [corridorDistance]);

  useEffect(() => { loadHotspots(); }, [loadHotspots]);

  const selectedHotspot = useMemo(() => hotspots?.items?.find((item) => String(item.junction_id) === String(junctionId)), [hotspots, junctionId]);

  async function calculateEmissions() {
    setEstimateBusy(true); setMessage('');
    try {
      const data = await api.post('/air-intelligence/emissions/estimate', {
        vehicle_counts: Object.fromEntries(Object.entries(vehicleCounts).map(([key, value]) => [key, Number(value) || 0])),
        segment_distance_km: Number(corridorDistance),
      });
      setEstimate(data);
      notify('Traffic-related emissions estimate calculated.');
    } catch (error) { setMessage(error.message || 'Emission estimate failed.'); }
    finally { setEstimateBusy(false); }
  }

  async function generatePlan() {
    if (!junctionId) { setMessage('Register or select a junction first.'); return; }
    setPlanBusy(true); setMessage(''); setComparison(null);
    try {
      const data = await api.post('/air-intelligence/signal-plans/optimize', {
        junction_id: Number(junctionId),
        cycle_seconds: Number(cycleSeconds),
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
        scenario: 'baseline', name: 'HawaFlow baseline vs intervention',
      });
      setComparison(data);
      notify('Baseline and intervention simulation completed.');
    } catch (error) { setMessage(error.message || 'The comparison could not run. SUMO may be missing.'); }
    finally { setCompareBusy(false); }
  }

  async function downloadImpactReport() {
    if (!comparison?.simulation_id) return;
    try {
      const report = await api.get(`/air-intelligence/reports/${comparison.simulation_id}`);
      downloadJson(report, `urbansaarthi-impact-report-${comparison.simulation_id}.json`);
    } catch (error) { setMessage(error.message || 'Report could not be downloaded.'); }
  }

  const hotspotItems = hotspots?.items || [];
  const topHotspot = hotspotItems[0];
  const emissionComparison = comparison?.result?.emissions_comparison;
  const trafficComparison = comparison?.result?.traffic_comparison;

  return <main className="air-intel-page">
    <PageIntro eyebrow="HAWAFLOW AI · INNOVATEX THEME 2" title="Air intelligence" description="Identify traffic-related hotspots, estimate tailpipe emissions and test signal interventions before operator sign-off." action={<button className="secondary" onClick={loadHotspots} disabled={hotspotBusy}><RefreshCw size={15} className={hotspotBusy ? 'ai-spin' : ''}/> Refresh hotspots</button>} />

    <div className="ai-notice"><ShieldCheck size={16}/><span>Measured traffic and ambient AQI stay separate from modelled tailpipe emissions. Hotspot scores are relative to the returned junction set, not regulatory AQI values.</span></div>

    <section className="ai-kpis">
      <article className="ai-kpi"><span><Flame size={16}/> Ranked hotspots</span><b>{hotspots ? hotspotItems.length : '—'}</b><small>Recent junction observations</small></article>
      <article className="ai-kpi"><span><Activity size={16}/> Highest hotspot score</span><b>{number(topHotspot?.hotspot_score, 1)}</b><small>{topHotspot?.junction_name || 'Waiting for observations'}</small></article>
      <article className="ai-kpi"><span><CloudSun size={16}/> Nearby AQI observations</span><b>{hotspotItems.filter((item) => item.ambient_air_quality).length}</b><small>Nearest station within 5 km</small></article>
      <article className="ai-kpi"><span><Signal size={16}/> Junctions with emissions</span><b>{hotspotItems.filter((item) => item.emissions).length}</b><small>Vehicle-class counts available</small></article>
    </section>

    <section className="ai-section-grid">
      <div className="ai-panel ai-hotspot-panel">
        <div className="ai-panel-head"><div><span className="ai-kicker">01 / POLLUTION HOTSPOTS</span><h3>Where should operators look first?</h3></div><span className="ai-source-pill">24H OBSERVATION WINDOW</span></div>
        <div className="ai-distance-control"><label>Assumed monitored corridor length</label><div><input type="number" min="0.001" max="100" step="0.1" value={corridorDistance} onChange={(event) => setCorridorDistance(event.target.value)}/><span>km</span></div></div>
        {hotspotError && <div className="ai-inline-error"><AlertTriangle size={15}/>{hotspotError}</div>}
        {hotspotBusy && !hotspots ? <div className="ai-empty"><LoaderCircle className="ai-spin"/> Loading latest junction evidence…</div> : hotspotItems.length ? <div className="ai-hotspot-list">
          {hotspotItems.map((item) => <button key={item.junction_id} className={`ai-hotspot-row ${String(item.junction_id) === String(junctionId) ? 'selected' : ''}`} onClick={() => setJunctionId(String(item.junction_id))}>
            <span className="ai-rank">{String(item.rank).padStart(2, '0')}</span>
            <span className="ai-hotspot-main"><b>{item.junction_name}</b><small>{item.traffic?.vehicle_count ?? 0} vehicles · {(item.data_quality || 'not available').replaceAll('_', ' ')}</small></span>
            <span className="ai-hotspot-components"><small>Traffic {number(item.traffic?.congestion_score, 0)}</small><small>AQI {number(item.ambient_air_quality?.aqi, 0)}</small></span>
            <strong>{number(item.hotspot_score, 1)}</strong>
          </button>)}
        </div> : <div className="ai-empty"><CloudSun size={22}/><b>No recent hotspot evidence</b><p>Upload a traffic clip in Traffic Lab or ingest traffic observations. Hotspots will appear when junction observations are recorded.</p></div>}
        <p className="ai-footnote">{hotspots?.note || 'Ranking combines available congestion, estimated NOx + PM and nearby ambient AQI.'}</p>
      </div>

      <div className="ai-panel ai-estimator-panel">
        <div className="ai-panel-head"><div><span className="ai-kicker">02 / TRAFFIC-TO-EMISSIONS</span><h3>Tailpipe emissions estimator</h3></div><span className="ai-source-pill">{factors?.factor_version || 'BS-VI PROFILE'}</span></div>
        <p className="ai-intro-copy">Enter the vehicle mix observed on this corridor to estimate tailpipe emissions. These manual totals are separate from signal optimization, which needs camera-calibrated approach counts.</p>
        <div className="ai-count-grid">
          {[['car', 'Cars'], ['motorbike', 'Two-wheelers'], ['bus', 'Buses'], ['truck', 'Trucks'], ['bicycle', 'Bicycles']].map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="1000000" value={vehicleCounts[key]} onChange={(event) => setVehicleCounts((old) => ({ ...old, [key]: event.target.value }))}/></label>)}
        </div>
        <button className="ai-primary-button" onClick={calculateEmissions} disabled={estimateBusy}>{estimateBusy ? <><LoaderCircle size={15} className="ai-spin"/> Calculating…</> : <><Activity size={15}/> Calculate emissions</>}</button>
        {estimate && <div className="ai-estimate-result">
          <div className="ai-emission-total"><span>Estimated CO₂</span><b>{number(estimate.totals?.co2_g, 1)} <small>g</small></b></div>
          <div className="ai-pollutant-grid"><div><span>NOx</span><b>{number(estimate.totals?.nox_g, 3)} g</b></div><div><span>PM</span><b>{number(estimate.totals?.pm_g, 3)} g</b></div><div><span>CO</span><b>{number(estimate.totals?.co_g, 2)} g</b></div><div><span>Activity</span><b>{number(estimate.vehicle_km, 2)} veh-km</b></div></div>
          <button className="ai-text-button" onClick={() => downloadJson(estimate, 'urbansaarthi-emissions-estimate.json')}><ArrowDownToLine size={14}/> Download calculation and assumptions</button>
        </div>}
        <p className="ai-footnote">Distance assumption: {corridorDistance || '0.5'} km per counted vehicle. Default fuel-use values are project assumptions; replace them with local fleet data for field estimates.</p>
      </div>
    </section>

    <section className="ai-panel ai-optimization-panel">
      <div className="ai-panel-head"><div><span className="ai-kicker">03 / EMISSIONS-AWARE SIGNAL OPTIMIZATION</span><h3>Generate a candidate signal plan</h3></div><span className="ai-review-pill"><ShieldCheck size={13}/> Human review required</span></div>
      <div className="ai-optimization-controls">
        <label><span>Junction</span><select value={junctionId} onChange={(event) => { setJunctionId(event.target.value); setPlan(null); setComparison(null); }}><option value="">Select junction</option>{junctions.map((item) => <option key={item.id} value={item.id}>{item.name} · #{item.id}</option>)}</select></label>
        <label><span>Signal cycle</span><select value={cycleSeconds} onChange={(event) => setCycleSeconds(event.target.value)}>{[60, 75, 90, 105, 120, 135, 150].map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>
        <button className="ai-primary-button" onClick={generatePlan} disabled={!junctionId || planBusy}>{planBusy ? <><LoaderCircle size={15} className="ai-spin"/> Optimizing…</> : <><SlidersHorizontal size={15}/> Generate plan</>}</button>
      </div>
      <p className="ai-footnote">Signal optimization uses the latest saved camera approach counts for this junction, not the manual totals in the emissions estimator. Directional optimization requires all four calibrated ROI IDs: <code>north_south_through</code>, <code>east_west_through</code>, <code>north_south_turn</code>, <code>east_west_turn</code>. These are collected in Traffic Lab's camera calibration settings. Without them, this section creates an equal-split draft and labels it accordingly.</p>
      {plan && <div className="ai-plan-result">
        <div className="ai-plan-head"><div><span className="ai-kicker">CANDIDATE PLAN #{plan.id}</span><h4>{plan.cycle_seconds}s cycle</h4></div><span className={`ai-status-pill ${plan.projected_outcomes?.optimized ? 'optimized' : 'fallback'}`}>{plan.projected_outcomes?.optimized ? 'EMISSIONS-AWARE DRAFT' : 'EQUAL-SPLIT FALLBACK'}</span></div>
        <p>{plan.rationale}</p>
        <div className="ai-phase-bars">{plan.phases?.map((phase) => <div key={phase.movement}><div><b>{MOVEMENT_LABELS[phase.movement] || phase.name}</b><span>{phase.green_seconds}s green</span></div><div className="ai-phase-track"><i style={{ width: `${Math.min(100, phase.green_seconds / Math.max(1, plan.cycle_seconds) * 100)}%` }}/></div><small>{phase.yellow_seconds}s yellow · {phase.all_red_seconds}s all-red</small></div>)}</div>
        <div className="ai-plan-actions"><span><ShieldCheck size={15}/> Draft saved. Review it in Signal Plans before approval.</span><button className="ai-primary-button" onClick={comparePlan} disabled={compareBusy}>{compareBusy ? <><LoaderCircle size={15} className="ai-spin"/> Running SUMO…</> : <><Activity size={15}/> Compare baseline vs intervention</>}</button></div>
      </div>}
      {message && <div className="ai-inline-error"><AlertTriangle size={15}/>{message}</div>}
    </section>

    {comparison && <section className="ai-panel ai-comparison-panel">
      <div className="ai-panel-head"><div><span className="ai-kicker">04 / ENVIRONMENTAL IMPACT</span><h3>Baseline versus intervention</h3></div><span className="ai-native-pill"><CheckCircle2 size={13}/> {comparison.engine}</span></div>
      <div className="ai-comparison-grid"><div><span>Average waiting time</span><b>{number(trafficComparison?.average_wait_seconds?.baseline, 1)}s <em>→</em> {number(trafficComparison?.average_wait_seconds?.proposed, 1)}s</b><small>{number(trafficComparison?.average_wait_seconds?.change_percent, 1)}% change</small></div><div><span>Queue at 60 min</span><b>{number(trafficComparison?.queue_at_60m?.baseline, 0)} <em>→</em> {number(trafficComparison?.queue_at_60m?.proposed, 0)}</b><small>{number(trafficComparison?.queue_at_60m?.change_percent, 1)}% change</small></div><div><span>Vehicles completed</span><b>{number(trafficComparison?.vehicles_completed?.baseline, 0)} <em>→</em> {number(trafficComparison?.vehicles_completed?.proposed, 0)}</b><small>{number(trafficComparison?.vehicles_completed?.change_percent, 1)}% change</small></div></div>
      <div className="ai-emissions-comparison"><div className="ai-emissions-comparison-head"><div><span className="ai-kicker">TAILPIPE EMISSIONS ESTIMATE</span><h4>{emissionComparison?.available ? 'Same demand · measured SUMO trip distance' : 'Emissions comparison unavailable'}</h4></div><Leaf size={20}/></div>
        {emissionComparison?.available ? <div className="ai-pollutant-grid">{[['CO₂', 'co2_g'], ['NOx', 'nox_g'], ['PM', 'pm_g'], ['CO', 'co_g']].map(([label, key]) => <div key={key}><span>{label}</span><b>{number(emissionComparison.proposed?.totals?.[key], 1)} g</b><small>{number(emissionComparison.change_percent?.[key], 2)}% vs baseline</small></div>)}</div> : <p className="ai-footnote">SUMO completed but trip-distance records were unavailable, so no emissions delta is shown.</p>}
      </div>
      <div className="ai-report-actions"><p>{comparison.caveats?.[0] || 'Native SUMO ran on the bundled synthetic grid. This is not a mapped Kanpur field simulation.'}</p><button className="ai-secondary-button" onClick={downloadImpactReport}><ArrowDownToLine size={15}/> Download environmental report</button></div>
    </section>}

    <section className="ai-source-panel"><div><span className="ai-kicker">FACTOR PROVENANCE</span><h3>What these numbers mean</h3><p>{factors?.method_note || 'Indicative factor profile loaded from the backend.'}</p></div><div className="ai-source-links"><a href={factors?.factor_source?.url} target="_blank" rel="noreferrer">{factors?.factor_source?.title || 'Indian source-apportionment factor source'}</a><a href={factors?.co2_method_source?.url} target="_blank" rel="noreferrer">{factors?.co2_method_source?.title || 'Fuel carbon-factor source'}</a></div></section>
  </main>;
}
